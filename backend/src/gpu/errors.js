export const GPU_ERROR_SOURCES = {
    VAST: 'vast',
    APP: 'app'
};

const PREFIX = {
    [GPU_ERROR_SOURCES.VAST]: 'Vast.ai: ',
    [GPU_ERROR_SOURCES.APP]: 'Slicer Web: '
};

export function formatGpuError(message, source = GPU_ERROR_SOURCES.APP) {
    const text = String(message || 'Unknown error').trim();
    const key = source === GPU_ERROR_SOURCES.VAST ? GPU_ERROR_SOURCES.VAST : GPU_ERROR_SOURCES.APP;
    const prefix = PREFIX[key];
    if (text.startsWith(prefix)) return text;
    return `${prefix}${text}`;
}

export function parseGpuError(message) {
    const raw = String(message || '').trim();
    if (raw.startsWith(PREFIX[GPU_ERROR_SOURCES.VAST])) {
        return {
            source: GPU_ERROR_SOURCES.VAST,
            message: raw.slice(PREFIX[GPU_ERROR_SOURCES.VAST].length),
            displayMessage: raw
        };
    }
    if (raw.startsWith(PREFIX[GPU_ERROR_SOURCES.APP])) {
        return {
            source: GPU_ERROR_SOURCES.APP,
            message: raw.slice(PREFIX[GPU_ERROR_SOURCES.APP].length),
            displayMessage: raw
        };
    }
    return {
        source: GPU_ERROR_SOURCES.APP,
        message: raw,
        displayMessage: formatGpuError(raw, GPU_ERROR_SOURCES.APP)
    };
}

export function gpuErrorTitle(source) {
    return source === GPU_ERROR_SOURCES.VAST
        ? 'Problem on Vast.ai'
        : 'GPU problem in Slicer Web';
}
