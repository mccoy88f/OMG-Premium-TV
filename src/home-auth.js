const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const AUTH_FILE = path.join(DATA_DIR, 'home-auth.json');
const COOKIE_NAME = 'home_unlocked';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 giorni
const SALT_LENGTH = 16;
const HASH_ITERATIONS = 100000;
const HASH_KEYLEN = 64;

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function loadAuth() {
    ensureDataDir();
    if (!fs.existsSync(AUTH_FILE)) {
        return { enabled: false, passwordHash: null, sessionSecret: null };
    }
    try {
        const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
        return {
            enabled: !!data.enabled,
            passwordHash: data.passwordHash || null,
            sessionSecret: data.sessionSecret || null
        };
    } catch (e) {
        return { enabled: false, passwordHash: null, sessionSecret: null };
    }
}

function saveAuth(data) {
    ensureDataDir();
    fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_KEYLEN, 'sha512').toString('hex');
}

function getState() {
    const auth = loadAuth();
    return { enabled: auth.enabled };
}

function setProtection(enabled, password) {
    const auth = loadAuth();
    if (enabled) {
        if (!password || password.length < 1) {
            return { success: false, message: 'Inserisci una password' };
        }
        const salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
        const passwordHash = hashPassword(password, salt);
        const sessionSecret = auth.sessionSecret || crypto.randomBytes(32).toString('hex');
        saveAuth({
            enabled: true,
            passwordHash: salt + ':' + passwordHash,
            sessionSecret
        });
        return { success: true };
    } else {
        saveAuth({
            enabled: false,
            passwordHash: null,
            sessionSecret: auth.sessionSecret || crypto.randomBytes(32).toString('hex')
        });
        return { success: true };
    }
}

function verifyPassword(password) {
    const auth = loadAuth();
    if (!auth.enabled || !auth.passwordHash) return false;
    const [salt, storedHash] = auth.passwordHash.split(':');
    if (!salt || !storedHash) return false;
    const hash = hashPassword(password, salt);
    return crypto.timingSafeEqual(Buffer.from(storedHash, 'hex'), Buffer.from(hash, 'hex'));
}

function getUnlockCookieValue() {
    const auth = loadAuth();
    if (!auth.sessionSecret) return null;
    const payload = 'unlocked:' + (Date.now() + COOKIE_MAX_AGE_MS);
    const hmac = crypto.createHmac('sha256', auth.sessionSecret).update(payload).digest('hex');
    return Buffer.from(payload + '.' + hmac).toString('base64');
}

function verifyUnlockCookie(cookieValue) {
    if (!cookieValue) return false;
    const auth = loadAuth();
    if (!auth.enabled || !auth.sessionSecret) return false;
    try {
        const decoded = Buffer.from(cookieValue, 'base64').toString();
        const [payload, hmac] = decoded.split('.');
        if (!payload || !hmac) return false;
        const expected = crypto.createHmac('sha256', auth.sessionSecret).update(payload).digest('hex');
        if (!crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'))) return false;
        const [, expiry] = payload.split(':');
        const expiryMs = parseInt(expiry, 10);
        return Date.now() < expiryMs;
    } catch (e) {
        return false;
    }
}

module.exports = {
    COOKIE_NAME,
    COOKIE_MAX_AGE_MS,
    getState,
    setProtection,
    verifyPassword,
    getUnlockCookieValue,
    verifyUnlockCookie
};
