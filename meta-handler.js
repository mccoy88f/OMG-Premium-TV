const config = require('./config');
const EPGManager = require('./epg-manager');

function normalizeId(id) {
    return id?.toLowerCase().replace(/[^\w.]/g, '').trim() || '';
}

function enrichWithDetailedEPG(meta, channelId, userConfig) {

    if (!userConfig.epg_enabled) {
        console.log('❌ EPG non abilitato');
        return meta;
    }

    const normalizedId = normalizeId(channelId);

    const currentProgram = EPGManager.getCurrentProgram(normalizedId);


    const upcomingPrograms = EPGManager.getUpcomingPrograms(normalizedId);

    if (currentProgram) {
        let description = [];

        description.push('📺 ON AIR NOW:', currentProgram.title);

        if (currentProgram.description) {
            description.push('', currentProgram.description);
        }

        description.push('', `⏰ ${currentProgram.start} - ${currentProgram.stop}`);

        if (currentProgram.category) {
            description.push(`🏷️ ${currentProgram.category}`);
        }

        if (upcomingPrograms?.length > 0) {
            description.push('', '📅 UPCOMING PROGRAMS:');
            upcomingPrograms.forEach(program => {
                description.push(
                    '',
                    `• ${program.start} - ${program.title}`
                );
                if (program.description) {
                    description.push(`  ${program.description}`);
                }
                if (program.category) {
                    description.push(`  🏷️ ${program.category}`);
                }
            });
        }

        meta.description = description.join('\n');
        meta.releaseInfo = `${currentProgram.title} (${currentProgram.start})`;
    } else {
    }

    return meta;
}

async function metaHandler({ type, id, config: userConfig }) {
    try {

        if (!userConfig.m3u) {
            console.log('❌ URL M3U mancante');
            return { meta: null };
        }

        if (global.CacheManager.cache.m3uUrl !== userConfig.m3u) {
            console.log('Cache M3U non aggiornata, ricostruzione...');
            await global.CacheManager.rebuildCache(userConfig.m3u, userConfig);
        }

        const channelId = id.split('|')[1];

        // Usa direttamente getChannel dalla cache, che ora gestisce correttamente i suffissi
        const channel = global.CacheManager.getChannel(channelId);

        if (!channel) {
            console.log('=== Fine Meta Handler ===\n');
            return { meta: null };
        }



        const meta = {
            id: channel.id,
            type: 'tv',
            name: channel.streamInfo?.tvg?.chno
                ? `${channel.streamInfo.tvg.chno}. ${channel.name}`
                : channel.name,
            poster: channel.poster || channel.logo,
            background: channel.background || channel.logo,
            logo: channel.logo,
            description: '',
            releaseInfo: 'LIVE',
            genre: channel.genre,
            posterShape: 'square',
            language: 'ita',
            country: 'ITA',
            isFree: true,
            behaviorHints: {
                isLive: true,
                defaultVideoId: channel.id
            }
        };

        if ((!meta.poster || !meta.background || !meta.logo) && channel.streamInfo?.tvg?.id) {
            const epgIcon = EPGManager.getChannelIcon(normalizeId(channel.streamInfo.tvg.id));
            if (epgIcon) {
                meta.poster = meta.poster || epgIcon;
                meta.background = meta.background || epgIcon;
                meta.logo = meta.logo || epgIcon;
            } else {
            }
        }

        let baseDescription = [];

        if (channel.streamInfo?.tvg?.chno) {
            baseDescription.push(`📺 Channel ${channel.streamInfo.tvg.chno}`);
        }

        if (channel.description) {
            baseDescription.push('', channel.description);
        } else {
            baseDescription.push('', `Channel ID: ${channel.streamInfo?.tvg?.id}`);
        }

        meta.description = baseDescription.join('\n');

        const enrichedMeta = enrichWithDetailedEPG(meta, channel.streamInfo?.tvg?.id, userConfig);

        console.log('✓ Meta handler completato');
        return { meta: enrichedMeta };
    } catch (error) {
        console.error('[MetaHandler] Errore:', error.message);
        console.log('=== Fine Meta Handler con Errore ===\n');
        return { meta: null };
    }
}

module.exports = metaHandler;
