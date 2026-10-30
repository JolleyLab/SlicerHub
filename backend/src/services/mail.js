/**
 * Outbound email via SMTP (nodemailer).
 * Dev: Mailpit (compose service `mailpit`, UI http://localhost:8025).
 * No-op when SMTP is not configured — callers keep copy-link fallback.
 */

import nodemailer from 'nodemailer';
import config from '../config/index.js';

let transporter = null;

export function isMailConfigured() {
    const mail = config.mail || {};
    if (mail.enabled === false) return false;
    return Boolean(mail.host);
}

function getTransporter() {
    if (!isMailConfigured()) return null;
    if (transporter) return transporter;
    const mail = config.mail;
    const opts = {
        host: mail.host,
        port: mail.port,
        secure: mail.secure,
        tls: mail.secure ? undefined : { rejectUnauthorized: false }
    };
    if (mail.user) {
        opts.auth = { user: mail.user, pass: mail.pass || '' };
    }
    transporter = nodemailer.createTransport(opts);
    return transporter;
}

/**
 * @param {{ to: string, subject: string, text: string, html?: string }} message
 * @returns {Promise<{ sent: boolean, messageId?: string, error?: string }>}
 */
export async function sendMail(message) {
    const to = String(message?.to || '').trim();
    const subject = String(message?.subject || '').trim();
    const text = String(message?.text || '');
    if (!to || !subject) {
        return { sent: false, error: 'Missing to/subject' };
    }
    const tx = getTransporter();
    if (!tx) {
        return { sent: false, error: 'SMTP not configured' };
    }
    try {
        const info = await tx.sendMail({
            from: config.mail.from,
            to,
            subject,
            text,
            html: message.html || undefined
        });
        return { sent: true, messageId: info?.messageId || null };
    } catch (err) {
        const error = err?.message || String(err);
        console.warn('sendMail failed:', error);
        return { sent: false, error };
    }
}

/**
 * Case signup invite email (single-use redeem link).
 */
export async function sendCaseSignupInviteEmail({
    to,
    caseTitle,
    inviteUrl,
    expiresAt,
    proposedRole
} = {}) {
    const title = caseTitle || 'a case';
    const role = String(proposedRole || 'collaborator').replace(/_/g, ' ');
    const expiry = expiresAt
        ? new Date(expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
        : null;
    const subject = `You're invited to join “${title}”`;
    const lines = [
        `You've been invited to join “${title}” as ${role}.`,
        '',
        'Open this link to create your account and join the case:',
        String(inviteUrl || ''),
        ''
    ];
    if (expiry) {
        lines.push(`This link expires on ${expiry}.`);
        lines.push('');
    }
    lines.push('If you were not expecting this, you can ignore this email.');

    const html = `
      <p>You've been invited to join <strong>${escapeHtml(title)}</strong> as ${escapeHtml(role)}.</p>
      <p><a href="${escapeAttr(inviteUrl)}">Create your account and join</a></p>
      ${expiry ? `<p>This link expires on ${escapeHtml(expiry)}.</p>` : ''}
      <p style="color:#666;font-size:13px;">If you were not expecting this, you can ignore this email.</p>
    `.trim();

    return sendMail({
        to,
        subject,
        text: lines.join('\n'),
        html
    });
}

/**
 * Registration received email — sent to the applicant immediately after their request is created.
 */
export async function sendRegistrationReceivedEmail({ to, firstName } = {}) {
    const name = String(firstName || '').trim() || 'there';
    const subject = "We've received your SlicerHub access request";
    const lines = [
        `Hi ${name},`,
        '',
        'Thank you for requesting access to SlicerHub. We\'ve received your request and an administrator will review it shortly.',
        '',
        'We\'ll send you another email with a link to activate your account once your request has been approved.',
        '',
        'If you did not make this request, you can safely ignore this email.'
    ];

    const html = `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Thank you for requesting access to <strong>SlicerHub</strong>. We've received your request and an administrator will review it shortly.</p>
      <p>We'll send you another email with a link to activate your account once your request has been approved.</p>
      <p style="color:#666;font-size:13px;">If you did not make this request, you can safely ignore this email.</p>
    `.trim();

    return sendMail({ to, subject, text: lines.join('\n'), html });
}

/**
 * Registration approval email — sent to the applicant with their one-time completion link.
 */
export async function sendRegistrationApprovalEmail({
    to,
    firstName,
    completionUrl,
    expiresAt
} = {}) {
    const name = String(firstName || '').trim() || 'there';
    const expiry = expiresAt
        ? new Date(expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
        : null;
    const subject = 'Your SlicerHub account request has been approved';
    const lines = [
        `Hi ${name},`,
        '',
        'Your request to access SlicerHub has been approved.',
        '',
        'Click the link below to set your password and activate your account:',
        String(completionUrl || ''),
        ''
    ];
    if (expiry) {
        lines.push(`This link expires on ${expiry}.`);
        lines.push('');
    }
    lines.push('If you did not request access, you can ignore this email.');

    const html = `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Your request to access <strong>SlicerHub</strong> has been approved.</p>
      <p><a href="${escapeAttr(completionUrl)}">Set your password and activate your account</a></p>
      ${expiry ? `<p>This link expires on ${escapeHtml(expiry)}.</p>` : ''}
      <p style="color:#666;font-size:13px;">If you did not request access, you can ignore this email.</p>
    `.trim();

    return sendMail({ to, subject, text: lines.join('\n'), html });
}

/**
 * Registration pending review — sent to each member of the approvers group.
 * Deliberately vague: no count, no applicant details, group-task framing.
 */
export async function sendRegistrationPendingReviewEmail({ to, firstName, reviewUrl } = {}) {
    const name = String(firstName || '').trim() || 'there';
    const url = String(reviewUrl || '');
    const subject = 'Pending registration requests to review';
    const lines = [
        `Hi ${name},`,
        '',
        'There are pending registration requests awaiting review by your group.',
        '',
        url ? `Review them here: ${url}` : 'Sign in to SlicerHub to review them.',
        '',
        'This is a shared task — no action is required from you personally if a colleague has already handled it.'
    ];

    const linkHtml = url
        ? `<p><a href="${escapeAttr(url)}">Review pending requests</a></p>`
        : '<p>Sign in to SlicerHub to review them.</p>';

    const html = `
      <p>Hi ${escapeHtml(name)},</p>
      <p>There are pending registration requests awaiting review by your group.</p>
      ${linkHtml}
      <p style="color:#666;font-size:13px;">This is a shared task — no action is required from you personally if a colleague has already handled it.</p>
    `.trim();

    return sendMail({ to, subject, text: lines.join('\n'), html });
}

/**
 * Account activation email — for migrated/provisioned users setting a password for the first time.
 */
export async function sendAccountActivationEmail({ to, firstName, activationUrl, expiresAt } = {}) {
    const name = String(firstName || '').trim() || 'there';
    const expiry = expiresAt
        ? new Date(expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
        : null;
    const subject = 'Activate your SlicerHub account';
    const lines = [
        `Hi ${name},`,
        '',
        'Your SlicerHub account has been created. Click the link below to set your password and get started:',
        String(activationUrl || ''),
        ''
    ];
    if (expiry) { lines.push(`This link expires on ${expiry}.`, ''); }
    lines.push('If you were not expecting this, you can ignore this email.');

    const html = `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Your <strong>SlicerHub</strong> account has been created. Click the link below to set your password and get started:</p>
      <p><a href="${escapeAttr(activationUrl)}">Activate my account</a></p>
      ${expiry ? `<p>This link expires on ${escapeHtml(expiry)}.</p>` : ''}
      <p style="color:#666;font-size:13px;">If you were not expecting this, you can ignore this email.</p>
    `.trim();

    return sendMail({ to, subject, text: lines.join('\n'), html });
}

/**
 * Password reset email — for existing users who forgot their password.
 */
export async function sendPasswordResetEmail({ to, firstName, resetUrl, expiresAt } = {}) {
    const name = String(firstName || '').trim() || 'there';
    const expiry = expiresAt
        ? new Date(expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
        : null;
    const subject = 'Reset your SlicerHub password';
    const lines = [
        `Hi ${name},`,
        '',
        'We received a request to reset your SlicerHub password. Click the link below:',
        String(resetUrl || ''),
        ''
    ];
    if (expiry) { lines.push(`This link expires on ${expiry}.`, ''); }
    lines.push('If you did not request a password reset, you can ignore this email — your password will not change.');

    const html = `
      <p>Hi ${escapeHtml(name)},</p>
      <p>We received a request to reset your <strong>SlicerHub</strong> password.</p>
      <p><a href="${escapeAttr(resetUrl)}">Reset my password</a></p>
      ${expiry ? `<p>This link expires on ${escapeHtml(expiry)}.</p>` : ''}
      <p style="color:#666;font-size:13px;">If you did not request a password reset, you can ignore this email — your password will not change.</p>
    `.trim();

    return sendMail({ to, subject, text: lines.join('\n'), html });
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, '&#39;');
}
