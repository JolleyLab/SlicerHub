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
        'We\'ll email you again once your request has been approved.',
        '',
        'If you did not make this request, you can safely ignore this email.'
    ];

    const html = `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Thank you for requesting access to <strong>SlicerHub</strong>. We've received your request and an administrator will review it shortly.</p>
      <p>We'll email you again once your request has been approved.</p>
      <p style="color:#666;font-size:13px;">If you did not make this request, you can safely ignore this email.</p>
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
 * Access approved — for an account that already exists (e.g. hospital sign-in) and was
 * waiting for approval. No link to set a password: they just sign in.
 */
export async function sendAccessApprovedEmail({ to, firstName, signInUrl } = {}) {
    const name = String(firstName || '').trim() || 'there';
    const url = String(signInUrl || '');
    const subject = 'Your SlicerHub access has been approved';
    const lines = [
        `Hi ${name},`,
        '',
        'Your request to access SlicerHub has been approved. You can sign in now:',
        url,
        '',
        'If you did not request access, you can ignore this email.'
    ];
    const html = `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Your request to access <strong>SlicerHub</strong> has been approved.</p>
      <p><a href="${escapeAttr(url)}">Sign in to SlicerHub</a></p>
      <p style="color:#666;font-size:13px;">If you did not request access, you can ignore this email.</p>
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
