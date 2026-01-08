const axios = require('axios');
const { URL } = require('url');
const config = require('./config');

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

    async checkProxyHealth(proxyUrl, headers = {}) {
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
            // Log dettagliato in caso di fallimento di tutti i tentativi
            console.error('❌ ERRORE PROXY HEALTH CHECK - Tutti i tentativi falliti:');
            
            if (lastError) {
                console.error(`  Ultimo errore: ${lastError.message}`);
                console.error(`  Codice errore: ${lastError.code || 'N/A'}`);
                
                // Log dello stack trace per debug avanzato
            } else {
                console.error(`  Nessun errore specifico rilevato, controllo fallito senza eccezioni`);
            }
            
            // Log degli headers usati nella richiesta
            console.error('============================================================');
        } else if (attempts > 1) {
            // Log di successo dopo tentativi multipli
            console.log(`✅ Proxy verificato con successo dopo ${attempts} tentativi`);
        }
        
        return isHealthy;
    }

    async buildProxyUrl(streamUrl, headers = {}, userConfig = {}) {
        if (!userConfig.proxy || !userConfig.proxy_pwd || !streamUrl || typeof streamUrl !== 'string') {
            console.warn('⚠️ buildProxyUrl: Parametri mancanti o non validi');
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

    async getProxyStreams(input, userConfig = {}) {
        // Blocca solo gli URL che sono già proxy
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
            console.log(`⚠️ Dominio escluso dal proxy: ${input.url}`);
            return [{
                name: input.name,
                title: `${input.originalName}`,
                url: input.url,
                headers: input.headers,
                behaviorHints: {
                    notWebReady: false,
                    bingeGroup: "tv"
                }
            }];
        }
        
        // Se il proxy non è configurato, interrompe l'elaborazione
        if (!userConfig.proxy || !userConfig.proxy_pwd) {
            console.log('⚠️ Proxy non configurato per:', input.name);
            return [];
        }
    
        let streams = [];
        
        try {
            const headers = input.headers || {};
            
            // Assicura che lo User-Agent sia impostato
            if (!headers['User-Agent'] && !headers['user-agent']) {
                headers['User-Agent'] = config.defaultUserAgent;
            }
    
            // Costruisce l'URL del proxy (questa chiamata già normalizza l'URL rimuovendo lo slash finale)
            let proxyUrl = await this.buildProxyUrl(input.url, headers, userConfig);
    
            // Verifica se il proxy è attivo e funzionante
            let isHealthy = await this.checkProxyHealth(proxyUrl, headers);
            
            // Se il proxy non è sano, prova la versione con slash finale
            if (!isHealthy) {
                console.log(`⚠️ Proxy non valido, provo versione con slash finale per: ${input.url}`);
                
                // Aggiungi lo slash finale e riprova
                const urlWithSlash = input.url.endsWith('/') ? input.url : input.url + '/';
                const proxyUrlWithSlash = await this.buildProxyUrl(urlWithSlash, headers, userConfig);
                const isHealthyWithSlash = await this.checkProxyHealth(proxyUrlWithSlash, headers);
                
                if (isHealthyWithSlash) {
                    console.log(`✅ Versione con slash finale funzionante per: ${input.url}`);
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
    
            if (isHealthy) {
                // Aggiunge lo stream proxato all'array
                streams.push({
                    name: input.name,
                    title: `🌐 ${input.originalName}\n[Proxy ${streamType}]`,
                    url: proxyUrl,
                    behaviorHints: {
                        notWebReady: false,
                        bingeGroup: "tv"
                    }
                });
            } else {
                console.log(`⚠️ Proxy non valido per: ${input.url}, mantengo stream originale`);
                
                // Aggiungi lo stream originale se il proxy non funziona
                if (userConfig.force_proxy === 'true') {
                    streams.push({
                        name: input.name,
                        title: `${input.originalName}`,
                        url: input.url,
                        headers: input.headers,
                        behaviorHints: {
                            notWebReady: false,
                            bingeGroup: "tv"
                        }
                    });
                }
            }
        
        } catch (error) {
            console.error('❌ Errore durante l\'elaborazione del proxy:', error.message);
            
            // In caso di errore, aggiungi lo stream originale SOLO se force_proxy è attivo
            if (userConfig.force_proxy === 'true') {
                streams.push({
                    name: input.name,
                    title: `${input.originalName}`,
                    url: input.url,
                    headers: input.headers,
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
