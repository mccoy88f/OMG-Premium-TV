/**
 * Console logger that prefixes every line with session id for traceability.
 * Usage: log(sessionKey, 'Message', ...args) | sessionKey can be null/undefined → shown as '_'
 */
function prefix(sessionKey) {
    const sid = (sessionKey != null && String(sessionKey).trim() !== '') ? String(sessionKey).trim() : '_';
    return `[sess:${sid}]`;
}

function log(sessionKey, ...args) {
    if (args.length === 0) return;
    const p = prefix(sessionKey);
    if (typeof args[0] === 'string') {
        console.log(p, args[0], ...args.slice(1));
    } else {
        console.log(p, ...args);
    }
}

function error(sessionKey, ...args) {
    if (args.length === 0) return;
    const p = prefix(sessionKey);
    if (typeof args[0] === 'string') {
        console.error(p, args[0], ...args.slice(1));
    } else {
        console.error(p, ...args);
    }
}

function warn(sessionKey, ...args) {
    if (args.length === 0) return;
    const p = prefix(sessionKey);
    if (typeof args[0] === 'string') {
        console.warn(p, args[0], ...args.slice(1));
    } else {
        console.warn(p, ...args);
    }
}

module.exports = { log, error, warn, prefix };
