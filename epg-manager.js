const axios = require('axios');
const { parseStringPromise } = require('xml2js');
const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);
const cron = require('node-cron');

class EPGManager {
    constructor() {
        this.epgData = null;
        this.programGuide = new Map();
        this.channelIcons = new Map();
        this.lastUpdate = null;
        this.isUpdating = false;
        this.CHUNK_SIZE = 5000;
        this.lastEpgUrl = null;  // Nuova proprietà per tracciare l'ultimo URL EPG
        this.cronJob = null;     // Proprietà per il job cron
        this.cleanupJob = null;  // Job per la pulizia periodica
        this.validateAndSetTimezone();
        this.schedulePeriodicCleanup();
    }

    normalizeId(id) {
        return id?.toLowerCase().replace(/[^\w.]/g, '').trim() || '';
    }

    validateAndSetTimezone() {
        const tzRegex = /^[+-]\d{1,2}:\d{2}$/;
        const timeZone = process.env.TIMEZONE_OFFSET || '+2:00';

        if (!tzRegex.test(timeZone)) {
            this.timeZoneOffset = '+2:00';
            return;
        }

        this.timeZoneOffset = timeZone;
        const [hours, minutes] = this.timeZoneOffset.substring(1).split(':');
        this.offsetMinutes = (parseInt(hours) * 60 + parseInt(minutes)) *
            (this.timeZoneOffset.startsWith('+') ? 1 : -1);
    }

    formatDateIT(date) {
        if (!date) return '';
        const localDate = new Date(date.getTime() + (this.offsetMinutes * 60000));
        return localDate.toLocaleString('it-IT', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).replace(/\./g, ':');
    }

    parseEPGDate(dateString) {
        if (!dateString) return null;
        try {
            const regex = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})$/;
            const match = dateString.match(regex);

            if (!match) return null;

            const [_, year, month, day, hour, minute, second, timezone] = match;
            const tzHours = timezone.substring(0, 3);
            const tzMinutes = timezone.substring(3);
            const isoString = `${year}-${month}-${day}T${hour}:${minute}:${second}${tzHours}:${tzMinutes}`;

            const date = new Date(isoString);
            return isNaN(date.getTime()) ? null : date;
        } catch (error) {
            console.error('Errore nel parsing della data EPG:', error);
            return null;
        }
    }

    async initializeEPG(url) {
        // Se l'URL è lo stesso e la guida non è vuota, skip
        if (this.lastEpgUrl === url && this.programGuide.size > 0) {
            console.log('EPG già inizializzato e valido, skip...');
            return;
        }

        // Se l'URL è cambiato o la guida è vuota, aggiorna
        console.log('\n=== Inizializzazione EPG ===');
        console.log('URL EPG:', url);
        this.lastEpgUrl = url;
        await this.startEPGUpdate(url);

        // Se non esiste già un cron job, crealo
        if (!this.cronJob) {
            console.log('Schedulazione aggiornamento EPG giornaliero alle 3:00');
            this.cronJob = cron.schedule('0 3 * * *', () => {
                console.log('Esecuzione aggiornamento EPG programmato');
                this.startEPGUpdate(this.lastEpgUrl);
            });
        }
        console.log('=== Inizializzazione EPG completata ===\n');
    }

    cleanupOldPrograms() {
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        let removedCount = 0;

        console.log('\n=== Pulizia Programmi EPG Obsoleti ===');

        for (const [channelId, programs] of this.programGuide.entries()) {
            const initialCount = programs.length;
            const filteredPrograms = programs.filter(p => p.stop >= oneHourAgo);
            removedCount += initialCount - filteredPrograms.length;

            if (filteredPrograms.length > 0) {
                this.programGuide.set(channelId, filteredPrograms);
            } else {
                this.programGuide.delete(channelId);
            }
        }

        console.log(`✓ Rimossi ${removedCount} programmi obsoleti`);
        console.log(`✓ Canali rimanenti con EPG: ${this.programGuide.size}`);
        console.log('=== Pulizia Completata ===\n');

        return removedCount;
    }

    schedulePeriodicCleanup() {
        if (this.cleanupJob) {
            return; // Già schedulato
        }

        // Esegui pulizia ogni 6 ore
        this.cleanupJob = cron.schedule('0 */6 * * *', () => {
            console.log('\n⏰ Esecuzione pulizia periodica EPG programmata...');
            const removed = this.cleanupOldPrograms();
            if (removed > 0) {
                console.log(`✓ Memoria liberata: ~${(removed * 0.5).toFixed(1)} KB stimati`);
            }
        });

        console.log('✓ Pulizia periodica EPG schedulata (ogni 6 ore)');
    }

    async downloadAndProcessEPG(epgUrl) {
        console.log('\nDownload EPG da:', epgUrl.trim());
        try {
            const response = await axios.get(epgUrl.trim(), {
                responseType: 'arraybuffer',
                timeout: 100000,
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Accept-Encoding': 'gzip, deflate, br'
                }
            });

            let xmlString;
            try {
                xmlString = await gunzip(response.data);
                xmlString = xmlString.toString('utf8');
            } catch (gzipError) {
                try {
                    xmlString = zlib.inflateSync(response.data);
                    xmlString = xmlString.toString('utf8');
                } catch (zlibError) {
                    xmlString = response.data.toString('utf8');
                }
            }

            console.log('Inizio parsing XML...');
            const xmlData = await parseStringPromise(xmlString);
            console.log('Parsing XML completato');

            if (!xmlData || !xmlData.tv) {
                throw new Error('Struttura XML EPG non valida');
            }

            await this.processEPGInChunks(xmlData);
        } catch (error) {
            console.error(`❌ Errore EPG: ${error.message}`);
        }
    }

    async processEPGInChunks(data) {
        console.log('Inizio processamento EPG...');

        if (!data.tv) {
            console.error('❌ Errore: Nessun oggetto tv trovato nel file EPG');
            return;
        }

        if (data.tv && data.tv.channel) {
            console.log(`Trovati ${data.tv.channel.length} canali nel file EPG`);
            data.tv.channel.forEach(channel => {
                const id = channel.$.id;
                const icon = channel.icon?.[0]?.$?.src;
                if (id && icon) {
                    this.channelIcons.set(this.normalizeId(id), icon);
                }
            });
        } else {
            console.error('❌ Errore: Nessun canale trovato nel file EPG');
        }

        if (!data.tv || !data.tv.programme) {
            console.error('❌ Errore: Nessun programma trovato nel file EPG');
            return;
        }

        const programs = data.tv.programme;
        let totalProcessed = 0;

        console.log(`\nProcessamento di ${programs.length} voci EPG in blocchi di ${this.CHUNK_SIZE}`);

        // Definisci limiti temporali per ottimizzare la memoria
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        let skippedOld = 0;
        let skippedFuture = 0;

        for (let i = 0; i < programs.length; i += this.CHUNK_SIZE) {
            const chunk = programs.slice(i, i + this.CHUNK_SIZE);

            for (const program of chunk) {
                const channelId = program.$.channel;
                const normalizedChannelId = this.normalizeId(channelId);

                const start = this.parseEPGDate(program.$.start);
                const stop = this.parseEPGDate(program.$.stop);

                if (!start || !stop) continue;

                // Salta programmi troppo vecchi (più di 1 ora nel passato)
                if (stop < oneHourAgo) {
                    skippedOld++;
                    continue;
                }

                // Salta programmi troppo lontani nel futuro (oltre 7 giorni)
                if (start > sevenDaysFromNow) {
                    skippedFuture++;
                    continue;
                }

                if (!this.programGuide.has(normalizedChannelId)) {
                    this.programGuide.set(normalizedChannelId, []);
                }

                const programData = {
                    start,
                    stop,
                    title: program.title?.[0]?._ || program.title?.[0]?.$?.text || program.title?.[0] || 'Nessun Titolo',
                    description: program.desc?.[0]?._ || program.desc?.[0]?.$?.text || program.desc?.[0] || '',
                    category: program.category?.[0]?._ || program.category?.[0]?.$?.text || program.category?.[0] || ''
                };

                this.programGuide.get(normalizedChannelId).push(programData);
                totalProcessed++;
            }

            if ((i + this.CHUNK_SIZE) % 50000 === 0) {
                console.log(`Progresso: processate ${i + this.CHUNK_SIZE} voci...`);
            }
        }

        for (const [channelId, programs] of this.programGuide.entries()) {
            this.programGuide.set(channelId, programs.sort((a, b) => a.start - b.start));
        }

        console.log('\nRiepilogo Processamento EPG:');
        console.log(`✓ Totale voci processate: ${totalProcessed}`);
        console.log(`✓ Programmi vecchi saltati: ${skippedOld}`);
        console.log(`✓ Programmi futuri saltati (oltre 7 giorni): ${skippedFuture}`);
        console.log(`✓ Risparmio memoria stimato: ~${((skippedOld + skippedFuture) * 0.5).toFixed(1)} KB`);
    }

    async readExternalFile(url) {
        if (Array.isArray(url)) {
            return url;
        }

        if (url.includes(',')) {
            return url.split(',').map(u => u.trim());
        }

        try {
            console.log('Tentativo lettura file:', url);

            if (url.endsWith('.gz')) {
                console.log('File gzipped EPG trovato');
                return [url];
            }

            const response = await axios.get(url.trim());
            const content = response.data;

            if (typeof content === 'string' &&
                (content.includes('<?xml') || content.includes('<tv'))) {
                console.log('File EPG trovato direttamente');
                return [url];
            }

            const urls = content.split('\n')
                .filter(line => line.trim() !== '' && line.startsWith('http'));

            if (urls.length > 0) {
                console.log('Lista URLs trovata:', urls);
                return urls;
            }

            console.log('Nessun URL trovato, uso URL originale');
            return [url];

        } catch (error) {
            console.error('Errore nella lettura del file:', error);
            return [url];
        }
    }

    async startEPGUpdate(url) {
        if (this.isUpdating) {
            console.log('⚠️  Aggiornamento EPG già in corso, skip...');
            return;
        }

        console.log('\n=== Inizio Aggiornamento EPG ===');
        const startTime = Date.now();

        try {
            this.isUpdating = true;
            console.log('Inizio lettura URLs EPG...');

            const epgUrls = await this.readExternalFile(url);
            console.log('URLs trovati:', epgUrls);

            this.programGuide.clear();
            this.channelIcons.clear();

            for (const epgUrl of epgUrls) {
                console.log('\nProcesso URL EPG:', epgUrl);
                await this.downloadAndProcessEPG(epgUrl);
            }

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`\n✓ Aggiornamento EPG completato in ${duration} secondi`);
            console.log(`✓ Totale canali con dati EPG: ${this.programGuide.size}`);
            console.log(`✓ Totale canali con icone: ${this.channelIcons.size}`);

            // Esegui pulizia dopo l'aggiornamento per liberare memoria
            console.log('\n🧹 Esecuzione pulizia post-aggiornamento...');
            this.cleanupOldPrograms();

            console.log('=== Aggiornamento EPG Completato ===\n');

        } catch (error) {
            console.error('❌ Errore dettagliato durante l\'aggiornamento EPG:', error);
            console.error('Stack:', error.stack);
        } finally {
            this.isUpdating = false;
            this.lastUpdate = Date.now();
        }
    }

    getCurrentProgram(channelId) {
        if (!channelId) return null;
        const normalizedChannelId = this.normalizeId(channelId);
        const programs = this.programGuide.get(normalizedChannelId);

        if (!programs?.length) return null;

        const now = new Date();
        const currentProgram = programs.find(program => program.start <= now && program.stop >= now);

        if (currentProgram) {
            return {
                ...currentProgram,
                start: this.formatDateIT(currentProgram.start),
                stop: this.formatDateIT(currentProgram.stop)
            };
        }

        return null;
    }

    getUpcomingPrograms(channelId) {
        if (!channelId) return [];
        const normalizedChannelId = this.normalizeId(channelId);
        const programs = this.programGuide.get(normalizedChannelId);

        if (!programs?.length) return [];

        const now = new Date();

        return programs
            .filter(program => program.start >= now)
            .slice(0, 2)
            .map(program => ({
                ...program,
                start: this.formatDateIT(program.start),
                stop: this.formatDateIT(program.stop)
            }));
    }

    getChannelIcon(channelId) {
        return channelId ? this.channelIcons?.get(this.normalizeId(channelId)) : null;
    }

    needsUpdate() {
        if (!this.lastUpdate) return true;
        return (Date.now() - this.lastUpdate) >= (24 * 60 * 60 * 1000);
    }

    isEPGAvailable() {
        return this.programGuide.size > 0 && !this.isUpdating;
    }

    getStatus() {
        return {
            isUpdating: this.isUpdating,
            lastUpdate: this.lastUpdate ? this.formatDateIT(new Date(this.lastUpdate)) : 'Mai',
            channelsCount: this.programGuide.size,
            iconsCount: this.channelIcons.size,
            programsCount: Array.from(this.programGuide.values())
                .reduce((acc, progs) => acc + progs.length, 0),
            timezone: this.timeZoneOffset
        };
    }

    checkMissingEPG(m3uChannels) {
        const epgChannels = Array.from(this.programGuide.keys());
        const missingEPG = [];

        m3uChannels.forEach(ch => {
            const tvgId = ch.streamInfo?.tvg?.id;
            if (tvgId) {
                const normalizedTvgId = this.normalizeId(tvgId);
                if (!epgChannels.some(epgId => this.normalizeId(epgId) === normalizedTvgId)) {
                    missingEPG.push(ch);
                }
            }
        });

        if (missingEPG.length > 0) {
            console.log('\n=== Canali M3U senza EPG ===');
            missingEPG.forEach(ch => {
                console.log(`${ch.streamInfo?.tvg?.id}=`);
            });
            console.log(`✓ Totale canali M3U senza EPG: ${missingEPG.length}`);
            console.log('=============================\n');
        }
    }
}

module.exports = new EPGManager();
