const axios = require('axios');
const path = require('path');
const fs = require('fs');
const config = require('./config');

async function readExternalFile(url) {
  try {
      const response = await axios.get(url);
      const content = response.data;

      if (content.trim().startsWith('#EXTM3U')) {
          console.log('File M3U diretto trovato');
          return [url];
      }

      console.log('File lista URL trovato');
      return content.split('\n').filter(line => line.trim() !== '');
  } catch (error) {
      console.error('Errore nella lettura del file:', error);
      throw error;
  }
}

class PlaylistTransformer {
  constructor() {
      this.remappingRules = new Map();
      this.channelsMap = new Map();
      this.channelsWithoutStreams = [];
  }

  normalizeId(id) {
      return id?.toLowerCase().replace(/[^\w.]/g, '').trim() || '';
  }

  cleanChannelName(name) {
      return name
          .replace(/[\(\[].*?[\)\]]/g, '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '');
  }

  async loadRemappingRules(config) {
      console.log('Remapper path:', config?.remapper_path);
      const defaultPath = path.join(__dirname, 'link.epg.remapping');
      const remappingPath = config?.remapper_path || defaultPath;
    
      try {
          let content;
          if (remappingPath.startsWith('http')) {
              try {
                  const response = await axios.get(remappingPath);
                  content = response.data;
                  console.log('✓ Download remapping remoto completato');
              } catch (downloadError) {
                  console.error('❌ Download remoto fallito:', downloadError.message);
                  if (downloadError.response) {
                      console.error('Status:', downloadError.response.status);
                      console.error('Headers:', downloadError.response.headers);
                  }
                  console.log('Uso fallback locale:', defaultPath);
                  content = await fs.promises.readFile(defaultPath, 'utf8');
              }
          } else {
              content = await fs.promises.readFile(remappingPath, 'utf8');
          }

          let ruleCount = 0;
          content.split('\n').forEach(line => {
              line = line.trim();
              if (!line || line.startsWith('#')) return;
              const [m3uId, epgId] = line.split('=').map(s => s.trim());
              if (m3uId && epgId) {
                  this.remappingRules.set(this.normalizeId(m3uId), this.normalizeId(epgId));
                  ruleCount++;
              }
          });

          console.log(`✓ Caricate ${ruleCount} regole da ${remappingPath}`);
      } catch (error) {
          console.error('❌ Errore finale remapping:', error.message);
      }
  }

  parseVLCOpts(lines, currentIndex, extinf) {
      let i = currentIndex;
      
      // Debug per vedere il contenuto delle linee
      if (extinf.includes('tvg-name')) {
          const channelName = extinf.match(/tvg-name="([^"]+)"/) 
              ? extinf.match(/tvg-name="([^"]+)"/)[1]
              : 'Canale sconosciuto';
      }
      
      const extinfHeaders = {};
      const extinfopts = extinf.match(/http-[^=]+=["']([^"']+)/g);
      if (extinfopts) {
          extinfopts.forEach(opt => {
              const [key, value] = opt.split('=');
              extinfHeaders[key.replace('http-', '')] = value.replace(/["']/g, '');
          });
      }

      const vlcHeaders = {};
      while (i < lines.length && lines[i].startsWith('#EXTVLCOPT:')) {
          const opt = lines[i].substring('#EXTVLCOPT:'.length).trim();
          const [key, ...value] = opt.split('=');
          const headerKey = key.replace('http-', '');
          vlcHeaders[headerKey] = value.join('=');
          i++;
      }

      const httpHeaders = {};
      if (i < lines.length && lines[i].startsWith('#EXTHTTP:')) {
          try {
              const parsed = JSON.parse(lines[i].substring('#EXTHTTP:'.length));
              Object.assign(httpHeaders, parsed);
              i++;
          } catch (e) {
              console.error('Error parsing EXTHTTP:', e);
          }
      }

      const finalHeaders = {
          ...extinfHeaders,
          ...vlcHeaders,
          ...httpHeaders
      };

      // Unifica user-agent con varie priorità
      finalHeaders['User-Agent'] = httpHeaders['User-Agent'] || httpHeaders['user-agent'] ||
                                  vlcHeaders['user-agent'] || extinfHeaders['user-agent'] ||
                                  config.defaultUserAgent;

      // Normalizza referrer/referer - preferisci 'referrer' come nome finale
      if (vlcHeaders['referrer']) {
          finalHeaders['referrer'] = vlcHeaders['referrer'];
      } else if (vlcHeaders['referer']) {
          finalHeaders['referrer'] = vlcHeaders['referer'];
      }
      delete finalHeaders['referer'];

      // Normalizza origin
      if (vlcHeaders['origin']) {
          finalHeaders['origin'] = vlcHeaders['origin'];
      }

      // Debug degli header finali

      return { headers: finalHeaders, nextIndex: i };
  }
  
  parseChannelFromLine(line, headers, config) {
      const metadata = line.substring(8).trim();
      const tvgData = {};
  
      const tvgMatches = metadata.match(/([a-zA-Z-]+)="([^"]+)"/g) || [];
      tvgMatches.forEach(match => {
          const [key, value] = match.split('=');
          const cleanKey = key.replace('tvg-', '');
          tvgData[cleanKey] = value.replace(/"/g, '');
      });

      const groupMatch = metadata.match(/group-title="([^"]+)"/);
      let genres = [];
      if (groupMatch) {
          genres = groupMatch[1].split(';')
              .map(g => g.trim())
              .filter(g => g !== '' && g.toLowerCase() !== 'undefined');
      }
  
      // Se genres è vuoto, usa 'Other Channels'
      if (genres.length === 0) {
          genres = ['Altri Canali'];
      }

      const nameParts = metadata.split(',');
      const name = nameParts[nameParts.length - 1].trim();

      if (!tvgData.id) {
          const suffix = config?.id_suffix || '';
          tvgData.id = this.cleanChannelName(name) + (suffix ? `.${suffix}` : '');
      }

      return {
          name,
          group: genres,
          tvg: tvgData,
          headers
      };
  }

  getRemappedId(channel) {
      const originalId = channel.tvg.id;
      const suffix = config?.id_suffix || ''; // Ottieni il suffisso dalla configurazione
      const normalizedId = this.normalizeId(originalId) + (suffix ? `.${suffix}` : ''); // Aggiungi il suffisso all'ID normalizzato
      const remappedId = this.remappingRules.get(normalizedId);

      if (remappedId) {
          return this.normalizeId(remappedId);
      }

      return normalizedId; // Restituisci l'ID normalizzato con il suffisso
  }

  createChannelObject(channel, channelId) {
      const name = channel.tvg?.name || channel.name;
      const cleanName = name.replace(/\s*\(.*?\)\s*/g, '').trim();
      const suffix = config?.id_suffix || ''; // Ottieni il suffisso dalla configurazione
      const finalChannelId = channelId + (suffix ? `.${suffix}` : ''); // Aggiungi il suffisso all'ID del canale

      return {
          id: `tv|${finalChannelId}`, // Usa l'ID con il suffisso
          type: 'tv',
          name: cleanName,
          genre: channel.group,
          posterShape: 'square',
          poster: channel.tvg?.logo,
          background: channel.tvg?.logo,
          logo: channel.tvg?.logo,
          description: `Canale: ${cleanName} - ID: ${finalChannelId}`,
          runtime: 'LIVE',
          behaviorHints: {
              defaultVideoId: `tv|${finalChannelId}`,
              isLive: true
          },
          streamInfo: {
              urls: [],
              tvg: {
                  ...channel.tvg,
                  id: finalChannelId,
                  name: cleanName
              }
          }
      };
  }

  addStreamToChannel(channel, url, name, genres, headers) {
      if (genres) {
          genres.forEach(newGenre => {
              if (!channel.genre.includes(newGenre)) {
                  channel.genre.push(newGenre);
              }
          });
      }

      if (url === null || url.toLowerCase() === 'null') {
          channel.streamInfo.urls.push({
              url: 'https://static.vecteezy.com/system/resources/previews/001/803/236/mp4/no-signal-bad-tv-free-video.mp4',
              name: 'Nessuno flusso presente nelle playlist m3u',
              headers
          });
      } else {
          channel.streamInfo.urls.push({
              url,
              name,
              headers
          });
      }
  }
  
  async parseM3UContent(content, config) {
      const lines = content.split('\n');
      let currentChannel = null;
      const genres = new Set(['Undefined']);
  
      let epgUrl = null;
      if (lines[0].includes('url-tvg=')) {
          const match = lines[0].match(/url-tvg="([^"]+)"/);
          if (match) {
              epgUrl = match[1].split(',').map(url => url.trim());
              console.log('URL EPG trovati nella playlist:', epgUrl);
          }
      }
  
      for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
      
          if (line.startsWith('#EXTINF:')) {
              const { headers, nextIndex } = this.parseVLCOpts(lines, i + 1, line);
              i = nextIndex - 1;
              currentChannel = this.parseChannelFromLine(line, headers, config);

              // Verifica la presenza di User-Agent, Referrer e Origin
              const channelName = currentChannel.tvg?.name || currentChannel.name;


          } else if ((line.startsWith('http') || line.toLowerCase() === 'null') && currentChannel) {
              const remappedId = this.getRemappedId(currentChannel);
              const normalizedId = this.normalizeId(remappedId);

              if (!this.channelsMap.has(normalizedId)) {
                  const channelObj = this.createChannelObject(currentChannel, remappedId);
                  this.channelsMap.set(normalizedId, channelObj);
                  currentChannel.group.forEach(genre => genres.add(genre));
              }

              const channelObj = this.channelsMap.get(normalizedId);
              this.addStreamToChannel(channelObj, line, currentChannel.name, currentChannel.group, currentChannel.headers);
  
              currentChannel = null;
          }
      }

      this.channelsWithoutStreams = [];
      for (const [id, channel] of this.channelsMap.entries()) {
          if (channel.streamInfo.urls.length === 0) {
              this.channelsWithoutStreams.push(channel.name);
          }
      }

      if (this.channelsWithoutStreams.length > 0) {
          console.warn(`⚠️ Canali senza flussi riproducibili: ${this.channelsWithoutStreams.length}`);
          console.log('\n=== Canali senza flussi ===');
          this.channelsWithoutStreams.forEach(name => {
              console.log(`${name}`);
          });
          console.log('========================\n');
      }

      const channelsWithOnlyDummy = [];
      for (const [id, channel] of this.channelsMap.entries()) {
          if (channel.streamInfo.urls.length === 1 && 
              channel.streamInfo.urls[0].name === 'Nessuno flusso presente nelle playlist m3u') {
              channelsWithOnlyDummy.push(channel.name);
          }
      }

      if (channelsWithOnlyDummy.length > 0) {
          console.log('\n=== Canali con solo flusso dummy ===');
          channelsWithOnlyDummy.forEach(name => {
              console.log(`${name}`);
          });
          console.log(`✓ Totale canali con solo flusso dummy: ${channelsWithOnlyDummy.length}`);
          console.log('================================\n');
      }

      return {
          genres: Array.from(genres),
          epgUrl
      };
  }

  async loadAndTransform(url, config = {}) {
      try {
          await this.loadRemappingRules(config);
          
          // Supporto per URL multipli separati da virgola
          const urlList = url.split(',').map(u => u.trim()).filter(u => u);
          console.log('\n=== Inizio Processamento Playlist ===');
          console.log('URL M3U forniti:', urlList.length);
          
          let playlistUrls = [];
          
          // Processa ogni URL fornito
          for (const singleUrl of urlList) {
              console.log('Controllo URL:', singleUrl);
              try {
                  const response = await axios.get(singleUrl);
                  const content = response.data;
                  
                  if (content.startsWith('#EXTM3U')) {
                      // È un file M3U diretto
                      playlistUrls.push(singleUrl);
                      console.log('✓ File M3U diretto trovato:', singleUrl);
                  } else {
                      // È una lista di URL
                      const urls = content.split('\n').filter(line => line.trim() && line.startsWith('http'));
                      playlistUrls.push(...urls);
                      console.log('✓ Lista URL trovata, contiene', urls.length, 'playlist');
                  }
              } catch (error) {
                  console.error('❌ Errore nel processare URL:', singleUrl, error.message);
                  // Continua con gli altri URL anche se uno fallisce
              }
          }

          console.log('Playlist totali da processare:', playlistUrls.length);

          const allGenres = [];
          const allEpgUrls = new Set();
          
          for (const playlistUrl of playlistUrls) {
              console.log('\nProcesso playlist:', playlistUrl);
              const playlistResponse = await axios.get(playlistUrl);
              const result = await this.parseM3UContent(playlistResponse.data, config);
              
              result.genres.forEach(genre => {
                  if (!allGenres.includes(genre)) {
                      allGenres.push(genre);
                  }
              });
              
              if (result.epgUrl) {
                  if (Array.isArray(result.epgUrl)) {
                      result.epgUrl.forEach(url => allEpgUrls.add(url));
                  } else {
                      allEpgUrls.add(result.epgUrl);
                  }
              }
          }

          const finalResult = {
              genres: allGenres,
              channels: Array.from(this.channelsMap.values()),
              epgUrls: Array.from(allEpgUrls)
          };

          finalResult.channels.forEach(channel => {
              if (channel.streamInfo.urls.length > 1) {
                  channel.streamInfo.urls = channel.streamInfo.urls.filter(
                      stream => stream.name !== 'Nessuno flusso presente nelle playlist m3u'
                  );
              }
          });

          console.log('\nRiepilogo Processamento:');
          console.log(`✓ Totale canali processati: ${finalResult.channels.length}`);
          console.log(`✓ Totale generi trovati: ${finalResult.genres.length}`);
          if (allEpgUrls.size > 0) {
              console.log(`✓ URL EPG trovati: ${allEpgUrls.size}`);
          }
          console.log('=== Processamento Completato ===\n');

          this.channelsMap.clear();
          this.channelsWithoutStreams = [];
          return finalResult;

      } catch (error) {
          console.error('❌ Errore playlist:', error.message);
          throw error;
      }
  }
}

module.exports = PlaylistTransformer;
