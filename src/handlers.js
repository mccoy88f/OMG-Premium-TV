const config = require('./config');
const EPGManager = require('./epg-manager');
const logger = require('./logger');
const StreamProxyManager = require('./stream-proxy-manager')(config);
const ResolverStreamManager = require('./resolver-stream-manager')(config);

function getLanguageFromConfig(userConfig) {
    return userConfig.language || config.defaultLanguage || 'Italiana';
}

function normalizeId(id) {
    const beforeAt = (typeof id === 'string' && id.includes('@')) ? id.split('@')[0] : id;
    return beforeAt?.toLowerCase().replace(/[^\w.]/g, '').trim() || '';
}

function cleanNameForImage(name) {
    // Prima rimuoviamo la data e l'ora se presente (pattern: dd/dd/dd - dd:dd (CET))
    let cleaned = name.replace(/\d{2}\/\d{2}\/\d{2}\s*-\s*\d{2}:\d{2}\s*\(CET\)/g, '').trim();

    // Rimuoviamo l'anno se inizia con esso
    cleaned = cleaned.replace(/^20\d{2}\s+/, '');

    // Rimuoviamo caratteri speciali mantenendo spazi e trattini
    cleaned = cleaned.replace(/[^a-zA-Z0-9\s-]/g, '');

    // Rimuoviamo spazi multipli
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    // Prendiamo solo la parte principale del nome
    let parts = cleaned.split(' - ');
    if (parts.length > 1) {
        cleaned = parts[0].trim();
    }

    // Se ancora troppo lungo, tronchiamo preservando parole intere
    if (cleaned.length > 30) {
        let words = cleaned.split(' ');
        let result = '';
        for (let word of words) {
            if ((result + ' ' + word).length <= 27) {
                result += (result ? ' ' : '') + word;
            } else {
                break;
            }
        }
        cleaned = result + '...';
    }

    return cleaned || 'No Name';
}

async function catalogHandler({ type, id, extra, config: userConfig, cacheManager: cm, epgManager: em, pythonResolver, pythonRunner }) {
    const cacheManager = cm || global.CacheManager;
    const epgManager = em || require('./epg-manager');
    try {
        if (!userConfig.m3u) {
            logger.log(cacheManager?.sessionKey ?? '_', 'M3U URL missing in configuration');
            return { metas: [], genres: [] };
        }

        // Aggiorna sempre la configurazione
        await cacheManager.updateConfig(userConfig);

        const cacheEmpty = !cacheManager.cache?.stremioData?.channels?.length;
        if (cacheEmpty && userConfig.m3u && cacheManager.cache.m3uUrl !== userConfig.m3u) {
            logger.log(cacheManager?.sessionKey ?? '_', 'Catalog: cache empty, rebuilding playlist from M3U...');
            await cacheManager.rebuildCache(userConfig.m3u, userConfig);
        }

        // Se l'EPG è abilitato, inizializzalo con l'epgManager della sessione (non quello default)
        if (userConfig.epg_enabled === 'true') {
            const epgToUse = userConfig.epg ||
                (cacheManager.cache.epgUrls &&
                    cacheManager.cache.epgUrls.length > 0
                    ? cacheManager.cache.epgUrls.join(',')
                    : null);

            if (epgToUse) {
                await epgManager.initializeEPG(epgToUse);
            }
        }

        let { search, genre, skip = 0 } = extra || {};

        if (genre && genre.includes('&skip')) {
            const parts = genre.split('&skip');
            genre = parts[0];
            if (parts[1] && parts[1].startsWith('=')) {
                skip = parseInt(parts[1].substring(1)) || 0;
            }
        }

        // Se riceviamo un nuovo filtro (search o genre), lo salviamo
        if (search) {
            cacheManager.setLastFilter('search', search);
        } else if (genre) {
            cacheManager.setLastFilter('genre', genre);
        } else if (!skip) {
            // Se non c'è skip, significa che è una nuova richiesta senza filtri
            cacheManager.clearLastFilter();
        }

        skip = parseInt(skip) || 0;
        const ITEMS_PER_PAGE = 100;

        // Otteniamo i canali già filtrati
        let filteredChannels = cacheManager.getFilteredChannels();
        const cachedData = cacheManager.getCachedData();

        const paginatedChannels = filteredChannels.slice(skip, skip + ITEMS_PER_PAGE);

        const metas = paginatedChannels.map(channel => {
            const displayName = cleanNameForImage(channel.name);
            const encodedName = encodeURIComponent(displayName).replace(/%20/g, '+');
            const fallbackLogo = `https://dummyimage.com/500x500/590b8a/ffffff.jpg&text=${encodedName}`;
            const language = getLanguageFromConfig(userConfig);
            const languageAbbr = language.substring(0, 3).toUpperCase();

            const meta = {
                id: channel.id,
                type: 'tv',
                name: `${channel.name} [${languageAbbr}]`,
                poster: channel.poster || fallbackLogo,
                background: channel.background || fallbackLogo,
                logo: channel.logo || fallbackLogo,
                description: channel.description || `Channel: ${channel.name} - ID: ${channel.streamInfo?.tvg?.id}`,
                genre: channel.genre,
                posterShape: channel.posterShape || 'square',
                releaseInfo: 'LIVE',
                behaviorHints: {
                    isLive: true,
                    ...channel.behaviorHints
                },
                streamInfo: channel.streamInfo
            };

            if (channel.streamInfo?.tvg?.chno) {
                meta.name = `${channel.streamInfo.tvg.chno}. ${channel.name} [${languageAbbr}]`;
            }

            if ((!meta.poster || !meta.background || !meta.logo) && channel.streamInfo?.tvg?.id) {
                const epgIcon = epgManager.getChannelIcon(channel.streamInfo.tvg.id);
                if (epgIcon) {
                    meta.poster = meta.poster || epgIcon;
                    meta.background = meta.background || epgIcon;
                    meta.logo = meta.logo || epgIcon;
                }
            }

            return enrichWithEPG(meta, channel.streamInfo?.tvg?.id, userConfig, epgManager);
        });

        const SETTINGS_GENRE = '⚙️';
        const settingsLogo = 'https://raw.githubusercontent.com/mccoy88f/OMG-TV-Stremio-Addon/refs/heads/main/tv.png';
        const languageAbbr = (getLanguageFromConfig(userConfig).substring(0, 3)).toUpperCase();
        const pseudoChannels = [
            { id: 'tv|refreshm3u', name: 'Refresh M3U playlist' },
            { id: 'tv|refreshepg', name: 'Refresh EPG' }
        ];
        const settingsMetas = pseudoChannels.map(ch => ({
            id: ch.id,
            type: 'tv',
            name: `${ch.name} [${languageAbbr}]`,
            poster: settingsLogo,
            background: settingsLogo,
            logo: settingsLogo,
            description: `Channel: ${ch.name}`,
            genre: [SETTINGS_GENRE],
            posterShape: 'square',
            releaseInfo: 'LIVE',
            behaviorHints: { isLive: true },
            streamInfo: { tvg: { id: ch.id.replace('tv|', '') }, urls: [] }
        }));
        const rawGenres = cachedData.genres || [];
        const normalizedGenres = rawGenres.map(g => (g === '~SETTINGS~' || g === 'Settings' ? SETTINGS_GENRE : g));
        const genres = [...new Set([...normalizedGenres, SETTINGS_GENRE])];

        if (genre === SETTINGS_GENRE) {
            const settingsChannels = cacheManager.getChannelsByGenre(SETTINGS_GENRE);
            const settingsChannelsMetas = settingsChannels.map(channel => {
                const displayName = cleanNameForImage(channel.name);
                const encodedName = encodeURIComponent(displayName).replace(/%20/g, '+');
                const fallbackLogo = `https://dummyimage.com/500x500/590b8a/ffffff.jpg&text=${encodedName}`;
                const meta = {
                    id: channel.id,
                    type: 'tv',
                    name: `${channel.name} [${languageAbbr}]`,
                    poster: channel.poster || fallbackLogo,
                    background: channel.background || fallbackLogo,
                    logo: channel.logo || fallbackLogo,
                    description: channel.description || `Channel: ${channel.name}`,
                    genre: channel.genre,
                    posterShape: channel.posterShape || 'square',
                    releaseInfo: 'LIVE',
                    behaviorHints: { isLive: true, ...channel.behaviorHints },
                    streamInfo: channel.streamInfo
                };
                return meta;
            });
            const allSettingsMetas = [...settingsChannelsMetas, ...settingsMetas];
            const settingsPaginated = allSettingsMetas.slice(skip, skip + ITEMS_PER_PAGE);
            return { metas: settingsPaginated, genres };
        }
        return { metas, genres };

    } catch (error) {
        logger.error(cacheManager?.sessionKey ?? '_', 'Catalog handler error:', error);
        return { metas: [], genres: [] };
    }
}

function enrichWithEPG(meta, channelId, userConfig, epgManager) {
    const epg = epgManager || require('./epg-manager');
    if (!userConfig.epg_enabled || !channelId) {
        meta.description = `Live channel: ${meta.name}`;
        meta.releaseInfo = 'LIVE';
        return meta;
    }

    const currentProgram = epg.getCurrentProgram(normalizeId(channelId));
    const upcomingPrograms = epg.getUpcomingPrograms(normalizeId(channelId));

    if (currentProgram) {
        meta.description = `IN ONDA ORA:\n${currentProgram.title}`;

        if (currentProgram.description) {
            meta.description += `\n${currentProgram.description}`;
        }

        meta.description += `\nOrario: ${currentProgram.start} - ${currentProgram.stop}`;

        if (currentProgram.category) {
            meta.description += `\nCategoria: ${currentProgram.category}`;
        }

        if (upcomingPrograms && upcomingPrograms.length > 0) {
            meta.description += '\n\nPROSSIMI PROGRAMMI:';
            upcomingPrograms.forEach(program => {
                meta.description += `\n${program.start} - ${program.title}`;
            });
        }

        meta.releaseInfo = `In onda: ${currentProgram.title}`;
    }

    return meta;
}

const PSEUDO_CHANNEL_IDS = ['rigeneraplaylistpython', 'refreshm3u', 'refreshepg'];

async function streamHandler({ id, config: userConfig, cacheManager: cm, epgManager: em, pythonResolver, pythonRunner }) {
    const cacheManager = cm || global.CacheManager;
    const epgManager = em || require('./epg-manager');
    const runner = pythonRunner || require('./python-runner');
    try {
        const channelId = (typeof id === 'string' && id.includes('|')) ? id.split('|')[1] : (id || '');

        await cacheManager.updateConfig(userConfig);

        const isPseudo = PSEUDO_CHANNEL_IDS.includes(channelId);

        if (!isPseudo && !userConfig.m3u) {
            logger.log(cacheManager?.sessionKey ?? '_', 'M3U URL missing');
            return { streams: [] };
        }

        const NO_SIGNAL_URL = 'https://static.vecteezy.com/system/resources/previews/001/803/236/mp4/no-signal-bad-tv-free-video.mp4';
        const PSEUDO_STREAM_HINTS = { notWebReady: false, bingeGroup: 'tv' };
        const PSEUDO_MSG_SUFFIX = '\nGo back and reopen the catalog in Stremio to see changes.';

        function pseudoStream(success, title, url = NO_SIGNAL_URL) {
            return {
                streams: [{
                    name: success ? 'Completed' : 'Error',
                    title: (success ? '✅ ' : '❌ ') + title + PSEUDO_MSG_SUFFIX,
                    url,
                    behaviorHints: PSEUDO_STREAM_HINTS
                }]
            };
        }

        if (channelId === 'rigeneraplaylistpython') {
            const result = await runner.executeScript();
            if (result) {
                await cacheManager.rebuildCache(userConfig.m3u, userConfig);
                return pseudoStream(true, 'Playlist regenerated successfully.');
            }
            logger.log(cacheManager?.sessionKey ?? '_', 'Python script execution error');
            return pseudoStream(false, runner.lastError || 'Unknown error.');
        }

        if (channelId === 'refreshm3u') {
            try {
                if (!userConfig.m3u) return pseudoStream(false, 'M3U URL not configured.');
                await cacheManager.rebuildCache(userConfig.m3u, userConfig);
                return pseudoStream(true, 'M3U playlist refreshed.');
            } catch (err) {
                logger.error(cacheManager?.sessionKey ?? '_', 'Refresh M3U error:', err.message);
                return pseudoStream(false, err.message || 'Unknown error.');
            }
        }

        if (channelId === 'refreshepg') {
            try {
                if (userConfig.epg_enabled !== 'true' || !userConfig.epg) return pseudoStream(false, 'EPG not enabled or EPG URL missing.');
                await epgManager.startEPGUpdate(userConfig.epg);
                return pseudoStream(true, 'EPG updated.');
            } catch (err) {
                logger.error(cacheManager?.sessionKey ?? '_', 'Refresh EPG error:', err.message);
                return pseudoStream(false, err.message || 'Unknown error.');
            }
        }

        // Continua con il normale flusso per gli altri canali
        const channel = cacheManager.getChannel(channelId);

        if (!channel) {
            logger.log(cacheManager?.sessionKey ?? '_', 'Channel not found:', channelId);
            return { streams: [] };
        }

        let streams = [];
        let originalStreamDetails = [];

        // Prepara i dettagli dello stream originale per potenziale risoluzione o proxy
        if (channel.streamInfo.urls) {
            for (const stream of channel.streamInfo.urls) {
                const headers = stream.headers || {};
                if (!headers['User-Agent']) {
                    headers['User-Agent'] = config.defaultUserAgent;
                }

                originalStreamDetails.push({
                    name: channel.name,
                    originalName: stream.name,
                    url: stream.url,
                    headers: headers
                });
            }
        }


        if (userConfig.resolver_enabled === 'true' && userConfig.resolver_script) {
            logger.log(cacheManager?.sessionKey ?? '_', 'Using resolver for', channel.name);

            try {
                const streamDetails = {
                    name: channel.name,
                    originalName: channel.name,
                    streamInfo: {
                        urls: channel.streamInfo.urls
                    }
                };

                const resolvedStreams = await ResolverStreamManager.getResolvedStreams(streamDetails, userConfig, pythonResolver || require('./python-resolver'), cacheManager?.sessionKey);

                if (resolvedStreams && resolvedStreams.length > 0) {
                    logger.log(cacheManager?.sessionKey ?? '_', 'Got', resolvedStreams.length, 'resolved stream(s)');

                    if (userConfig.force_proxy === 'true') {
                        // Se force_proxy è attivo, mostriamo SOLO i flussi passati attraverso il proxy
                        if (userConfig.proxy && userConfig.proxy_pwd) {
                            logger.log(cacheManager?.sessionKey ?? '_', 'Applying proxy to resolved streams (force mode)...');

                            for (const resolvedStream of resolvedStreams) {
                                const proxyStreamDetails = {
                                    name: resolvedStream.name,
                                    originalName: resolvedStream.title,
                                    url: resolvedStream.url,
                                    headers: resolvedStream.headers || {}
                                };

                                const proxiedResolvedStreams = await StreamProxyManager.getProxyStreams(proxyStreamDetails, userConfig, cacheManager?.sessionKey);
                                streams.push(...proxiedResolvedStreams);
                            }

                            if (streams.length === 0) {
                                logger.log(cacheManager?.sessionKey ?? '_', 'No valid proxy for resolved streams and force_proxy is on, no stream available');
                            }
                        } else {
                            logger.log(cacheManager?.sessionKey ?? '_', 'Force proxy on but not configured correctly, using original resolved streams');
                            streams = resolvedStreams;
                        }
                    } else {
                        // Se force_proxy NON è attivo:
                        // 1. Aggiungiamo prima i flussi risolti originali
                        streams = resolvedStreams;

                        // 2. Aggiungiamo anche i flussi risolti tramite proxy, se il proxy è configurato
                        if (userConfig.proxy && userConfig.proxy_pwd) {
                            logger.log(cacheManager?.sessionKey ?? '_', 'Adding proxy streams to resolved streams...');

                            for (const resolvedStream of resolvedStreams) {
                                const proxyStreamDetails = {
                                    name: resolvedStream.name,
                                    originalName: resolvedStream.title,
                                    url: resolvedStream.url,
                                    headers: resolvedStream.headers || {}
                                };

                                const proxiedResolvedStreams = await StreamProxyManager.getProxyStreams(proxyStreamDetails, userConfig, cacheManager?.sessionKey);
                                streams.push(...proxiedResolvedStreams);
                            }
                        }
                    }
                } else {
                    logger.log(cacheManager?.sessionKey ?? '_', 'No resolved stream available, using standard streams');
                    // Riprendi con la logica standard solo se il resolver fallisce
                    streams = await processOriginalStreams(originalStreamDetails, channel, userConfig, cacheManager?.sessionKey);
                }
            } catch (resolverError) {
                logger.error(cacheManager?.sessionKey ?? '_', 'Stream resolution error:', resolverError);
                streams = await processOriginalStreams(originalStreamDetails, channel, userConfig, cacheManager?.sessionKey);
            }
        } else {
            streams = await processOriginalStreams(originalStreamDetails, channel, userConfig, cacheManager?.sessionKey);
        }

        // Aggiungi i metadati a tutti gli stream
        const displayName = cleanNameForImage(channel.name);
        const encodedName = encodeURIComponent(displayName).replace(/%20/g, '+');
        const fallbackLogo = `https://dummyimage.com/500x500/590b8a/ffffff.jpg&text=${encodedName}`;

        const meta = {
            id: channel.id,
            type: 'tv',
            name: channel.name,
            poster: channel.poster || fallbackLogo,
            background: channel.background || fallbackLogo,
            logo: channel.logo || fallbackLogo,
            description: channel.description || `Channel ID: ${channel.streamInfo?.tvg?.id}`,
            genre: channel.genre,
            posterShape: channel.posterShape || 'square',
            releaseInfo: 'LIVE',
            behaviorHints: {
                isLive: true,
                ...channel.behaviorHints
            },
            streamInfo: channel.streamInfo
        };

        if ((!meta.poster || !meta.background || !meta.logo) && channel.streamInfo?.tvg?.id) {
            const epgIcon = epgManager.getChannelIcon(channel.streamInfo.tvg.id);
            if (epgIcon) {
                meta.poster = meta.poster || epgIcon;
                meta.background = meta.background || epgIcon;
                meta.logo = meta.logo || epgIcon;
            }
        }

        streams.forEach(stream => {
            stream.meta = meta;
        });

        return { streams };
    } catch (error) {
        logger.error(cacheManager?.sessionKey ?? '_', 'Stream handler error:', error);
        return { streams: [] };
    }
}

async function processOriginalStreams(originalStreamDetails, channel, userConfig, sessionKey = null) {
    let streams = [];
    if (userConfig.force_proxy === 'true') {
        if (userConfig.proxy && userConfig.proxy_pwd) {
            for (const streamDetails of originalStreamDetails) {
                const proxyStreams = await StreamProxyManager.getProxyStreams(streamDetails, userConfig, sessionKey);
                streams.push(...proxyStreams);
            }
        }
    } else {
        for (const streamDetails of originalStreamDetails) {
            const language = getLanguageFromConfig(userConfig);
            const streamMeta = {
                name: streamDetails.name,
                title: `📺 ${streamDetails.originalName || streamDetails.name} [${language.substring(0, 3).toUpperCase()}]`,
                url: streamDetails.url,
                headers: streamDetails.headers,
                language: language,
                behaviorHints: {
                    notWebReady: false,
                    bingeGroup: "tv"
                }
            };
            streams.push(streamMeta);
            if (userConfig.proxy && userConfig.proxy_pwd) {
                const proxyStreams = await StreamProxyManager.getProxyStreams(streamDetails, userConfig, sessionKey);
                streams.push(...proxyStreams);
            }
        }
    }
    return streams;
}

module.exports = {
    catalogHandler,
    streamHandler,
    // Esporta anche la nuova funzione ausiliaria per poterla utilizzare in altri moduli se necessario
    processOriginalStreams
};
