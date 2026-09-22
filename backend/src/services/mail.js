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
