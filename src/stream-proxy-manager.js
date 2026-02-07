const axios = require('axios');
const { URL } = require('url');
const config = require('./config');
const logger = require('./logger');

function getLanguageFromConfig(userConfig) {
    return userConfig.language || config.defaultLanguage || 'Italiano';
}

class StreamProxyManager {
    constructor() {
        this.proxyCache = new Map();  // Usato per memorizzare lo stato di salute dei proxy
        this.lastCheck = new Map();   // Usato per memorizzare l'ultimo controllo di salute
        this.CACHE_DURATION = 1 * 60 * 1000; // 1 minuto
        this.MAX_RETRY_ATTEMPTS = 3; // Numero massimo di tentativi
        this.RETRY_DELAY = 500; // Intervallo tra i tentativi in ms
        // Domini sempre esclusi dal proxy
        this.EXCLUDED_DOMAINS = ['pluto.tv'];
    }

    async validateProxyUrl(url) {
        if (!url) return false;
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
            return false;
        }
    }

    // Funzione di sleep per il ritardo tra i tentativi
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async checkProxyHealth(proxyUrl, headers = {}, sessionKey = null) {
        const sk = sessionKey || '_';
        const cacheKey = proxyUrl;
        const now = Date.now();
        const lastCheckTime = this.lastCheck.get(cacheKey);

        // Se abbiamo un check recente, usiamo quello
        if (lastCheckTime && (now - lastCheckTime) < this.CACHE_DURATION) {
            return this.proxyCache.get(cacheKey);
        }

        // Prepara gli headers finali per la richiesta
        const finalHeaders = {
            'User-Agent': headers['User-Agent'] || headers['user-agent'] || config.defaultUserAgent
        };

        if (headers['referer'] || headers['Referer'] || headers['referrer'] || headers['Referrer']) {
            finalHeaders['Referer'] = headers['referer'] || headers['Referer'] || 
                                    headers['referrer'] || headers['Referrer'];
        }

        if (headers['origin'] || headers['Origin']) {
            finalHeaders['Origin'] = headers['origin'] || headers['Origin'];
        }

        // Implementazione dei tentativi multipli
        let attempts = 0;
        let isHealthy = false;
        let lastError = null;

        while (attempts < this.MAX_RETRY_ATTEMPTS && !isHealthy) {
            attempts++;
            
            try {                
                const response = await axios.get(proxyUrl, {
                    timeout: 10000,
                    validateStatus: status => status < 400,
                    headers: finalHeaders
                });
                
                isHealthy = response.status < 400;
                

            } catch (error) {
                lastError = error;

                
                // Se non è l'ultimo tentativo, aspetta prima di riprovare
                if (attempts < this.MAX_RETRY_ATTEMPTS) {
                    await this.sleep(this.RETRY_DELAY);
                }
            }
        }

        // Aggiorna la cache solo dopo tutti i tentativi
        this.proxyCache.set(cacheKey, isHealthy);
        this.lastCheck.set(cacheKey, now);
        
        if (!isHealthy) {
            logger.error(sk, 'Proxy health check failed after all attempts');
            if (lastError) {
                logger.error(sk, 'Last error:', lastError.message, 'Error code:', lastError.code || 'N/A');
            } else {
                logger.error(sk, 'No specific error, check failed without exceptions');
            }
        } else if (attempts > 1) {
            logger.log(sk, 'Proxy verified successfully after', attempts, 'attempt(s)');
        }
        return isHealthy;
    }

    async buildProxyUrl(streamUrl, headers = {}, userConfig = {}, sessionKey = null) {
        const sk = sessionKey || '_';
        if (!userConfig.proxy || !userConfig.proxy_pwd || !streamUrl || typeof streamUrl !== 'string') {
            logger.warn(sk, 'buildProxyUrl: Missing or invalid parameters');
            return null;
        }
    
        const baseUrl = userConfig.proxy.replace(/\/+$/, '');
        const params = new URLSearchParams({
            api_password: userConfig.proxy_pwd,
            d: streamUrl,
        });
    
        // Assicurati di avere uno user agent valido
        const userAgent = headers['User-Agent'] || headers['user-agent'] || config.defaultUserAgent || 'Mozilla/5.0';
        params.set('h_user-agent', userAgent);
    
        // Gestione referer
        let referer = headers['referer'] || headers['Referer'] || headers['referrer'] || headers['Referrer'];
        if (referer) {
            params.set('h_referer', referer);
        }
    
        // Gestione origin
        let origin = headers['origin'] || headers['Origin'];
        if (origin) {
            params.set('h_origin', origin);
        }
    
        // Determina il tipo di stream senza seguire i redirect
        let streamType = 'HLS'; // Default
        if (streamUrl.endsWith('.mpd')) {
            streamType = 'DASH';
        } else if (streamUrl.endsWith('.mp4')) {
            streamType = 'HTTP';
        } else if (streamUrl.endsWith('.php')) {
            streamType = 'PHP';
        }
    
        // Costruisci l'URL del proxy basato sul tipo di stream
        let proxyUrl;
        if (streamType === 'HLS') {
            proxyUrl = `${baseUrl}/proxy/hls/manifest.m3u8?${params.toString()}`;
        } else if (streamType === 'DASH') {
            proxyUrl = `${baseUrl}/proxy/mpd/manifest.m3u8?${params.toString()}`;
        } else if (streamType === 'PHP') {
            proxyUrl = `${baseUrl}/extractor/video?host=DLHD&redirect_stream=true&${params.toString()}`;
        } else {
            proxyUrl = `${baseUrl}/proxy/stream?${params.toString()}`;
        }
    
        return proxyUrl;
    }

    async getProxyStreams(input, userConfig = {}, sessionKey = null) {
        const sk = sessionKey || '_';
        if (input.url.includes(userConfig.proxy)) {
            return [];
        }
        
        // Escludi domini specifici dal proxy (anche con Force Proxy abilitato)
        const excludedDomains = [
            ...this.EXCLUDED_DOMAINS,
            ...(userConfig.excluded_domains || [])
        ];
        
        const shouldExclude = excludedDomains.some(domain => input.url.includes(domain));
        
        if (shouldExclude) {
            logger.log(sk, 'Domain excluded from proxy:', input.url);
            const language = getLanguageFromConfig(userConfig);
            return [{
                name: input.name,
                title: `${input.originalName} [${language.substring(0, 3).toUpperCase()}]`,
                url: input.url,
                headers: input.headers,
                language: language,
                behaviorHints: {
                    notWebReady: false,
                    bingeGroup: "tv"
                }
            }];
        }
        
        if (!userConfig.proxy || !userConfig.proxy_pwd) {
            logger.log(sk, 'Proxy not configured for:', input.name);
            return [];
        }
    
        let streams = [];
        
        try {
            const headers = input.headers || {};
            
            // Assicura che lo User-Agent sia impostato
            if (!headers['User-Agent'] && !headers['user-agent']) {
                headers['User-Agent'] = config.defaultUserAgent;
            }
    
            let proxyUrl = await this.buildProxyUrl(input.url, headers, userConfig, sessionKey);
            let isHealthy = await this.checkProxyHealth(proxyUrl, headers, sessionKey);
            if (!isHealthy) {
                logger.log(sk, 'Proxy invalid, trying trailing slash version for:', input.url);
                const urlWithSlash = input.url.endsWith('/') ? input.url : input.url + '/';
                const proxyUrlWithSlash = await this.buildProxyUrl(urlWithSlash, headers, userConfig, sessionKey);
                const isHealthyWithSlash = await this.checkProxyHealth(proxyUrlWithSlash, headers, sessionKey);
                if (isHealthyWithSlash) {
                    logger.log(sk, 'Trailing slash version working for:', input.url);
                    proxyUrl = proxyUrlWithSlash;
                    isHealthy = true;
                }
            }
            
            // Determina il tipo di stream (HLS, DASH, HTTP o PHP)
            let streamType = 'HLS'; // Default
            if (input.url.endsWith('.mpd')) {
                streamType = 'DASH';
            } else if (input.url.endsWith('.mp4')) {
                streamType = 'HTTP';
            } else if (input.url.endsWith('.php') || input.url.includes('/stream/stream-') || input.url.includes('daddylive.dad') || input.url.includes('/extractor/video')) {
                streamType = 'PHP';
            }
    
            const language = getLanguageFromConfig(userConfig);
            if (isHealthy) {
                // Aggiunge lo stream proxato all'array
                streams.push({
                    name: input.name,
                    title: `🌐 ${input.originalName} [${language.substring(0, 3).toUpperCase()}]\n[Proxy ${streamType}]`,
                    url: proxyUrl,
                    language: language,
                    behaviorHints: {
                        notWebReady: false,
                        bingeGroup: "tv"
                    }
                });
            } else {
                logger.log(sk, 'Proxy invalid for:', input.url, ', keeping original stream');
                
                // Aggiungi lo stream originale se il proxy non funziona
                if (userConfig.force_proxy === 'true') {
                    streams.push({
                        name: input.name,
                        title: `${input.originalName} [${language.substring(0, 3).toUpperCase()}]`,
                        url: input.url,
                        headers: input.headers,
                        language: language,
                        behaviorHints: {
                            notWebReady: false,
                            bingeGroup: "tv"
                        }
                    });
                }
            }
        
        } catch (error) {
            logger.error(sk, 'Proxy processing error:', error.message);
            if (userConfig.force_proxy === 'true') {
                const language = getLanguageFromConfig(userConfig);
                streams.push({
                    name: input.name,
                    title: `${input.originalName} [${language.substring(0, 3).toUpperCase()}]`,
                    url: input.url,
                    headers: input.headers,
                    language: language,
                    behaviorHints: {
                        notWebReady: false,
                        bingeGroup: "tv"
                    }
                });
            }
        }
    
        return streams;
    }
}

module.exports = () => new StreamProxyManager();
