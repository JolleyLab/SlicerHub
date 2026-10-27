/**
 * File-type detection helpers shared by the Directus and Payload attachment paths.
 * Determines whether a file can be opened in Slicer or previewed in a browser.
 */

const SLICER_OPEN_EXTENSIONS = Object.freeze([
    '.mrb', '.mrml',
    '.mcs', '.mxp',
    '.nrrd', '.nhdr',
    '.nii', '.nii.gz',
    '.mgz', '.mha',
    '.vtk', '.vtp', '.vtu',
    '.stl', '.obj', '.ply',
    '.dcm', '.dicom',
    '.fcsv',
    '.seg.nrrd',
]);

const BROWSER_PREVIEW_EXTENSIONS = Object.freeze([
    '.pdf', '.txt', '.csv', '.json', '.md',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
]);

const BROWSER_PREVIEW_MIME_PREFIXES = Object.freeze([
    'text/', 'image/', 'application/pdf', 'application/json',
]);

function lowerName(filename) {
    return String(filename || '').trim().toLowerCase();
}

export function detectIsMrb(filename, mimeType) {
    const n = lowerName(filename);
    return n.endsWith('.mrb')
        || mimeType === 'application/x-mrb'
        || mimeType === 'application/vnd.slicer.mrb';
}

export function detectCanOpenInSlicer(filename, mimeType) {
    if (detectIsMrb(filename, mimeType)) return true;
    const n = lowerName(filename);
    if (!n) return false;
    if (SLICER_OPEN_EXTENSIONS.some((ext) => n.endsWith(ext))) return true;
    const mime = String(mimeType || '').toLowerCase();
    return mime === 'application/dicom'
        || mime === 'application/x-nrrd'
        || mime === 'application/sla'
        || mime === 'model/stl'
        || mime === 'model/obj'
        || mime === 'model/mesh';
}

export function detectCanPreviewInBrowser(filename, mimeType) {
    if (detectCanOpenInSlicer(filename, mimeType)) return false;
    const n = lowerName(filename);
    if (BROWSER_PREVIEW_EXTENSIONS.some((ext) => n.endsWith(ext))) return true;
    const mime = String(mimeType || '').toLowerCase();
    return BROWSER_PREVIEW_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
}

export function attachmentOpenFlags(filename, mimeType) {
    return {
        isMrb:              detectIsMrb(filename, mimeType),
        canOpenInSlicer:    detectCanOpenInSlicer(filename, mimeType),
        canPreviewInBrowser: detectCanPreviewInBrowser(filename, mimeType),
    };
}
