const axios = require('axios');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const logger = require('./logger');

async function readExternalFile(url, sessionKey = null) {
  const sk = sessionKey || '_';
  try {
      const response = await axios.get(url);
      const content = response.data;

      if (content.trim().startsWith('#EXTM3U')) {
          logger.log(sk, 'Direct M3U file found');
          return [url];
      }

      logger.log(sk, 'URL list file found');
      return content.split('\n').filter(line => line.trim() !== '');
  } catch (error) {
      logger.error(sk, 'Error reading file:', error);
      throw error;
  }
}

class PlaylistTransformer {
  constructor() {
      this.remappingRules = new Map();
      this.channelsMap = new Map();
      this.channelsWithoutStreams = [];
      this._logKey = '_';
  }

  normalizeId(id) {
      const beforeAt = (typeof id === 'string' && id.includes('@')) ? id.split('@')[0] : id;
      return beforeAt?.toLowerCase().replace(/[^\w.]/g, '').trim() || '';
  }

  cleanChannelName(name) {
      return name
          .replace(/[\(\[].*?[\)\]]/g, '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '');
  }

  async loadRemappingRules(config) {
      logger.log(this._logKey, 'Remapper path:', config?.remapper_path);
      const defaultPath = path.join(__dirname, '..', 'link.epg.remapping');
      const remappingPath = config?.remapper_path || defaultPath;
    
      try {
          let content;
          if (remappingPath.startsWith('http')) {
              try {
                  const response = await axios.get(remappingPath);
                  content = response.data;
                  logger.log(this._logKey, 'Remote remapping download completed');
              } catch (downloadError) {
                  logger.error(this._logKey, 'Remote download failed:', downloadError.message);
                  if (downloadError.response) {
                      logger.error(this._logKey, 'Status:', downloadError.response.status);
                      logger.error(this._logKey, 'Headers:', downloadError.response.headers);
                  }
                  logger.log(this._logKey, 'Using local fallback:', defaultPath);
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

          logger.log(this._logKey, 'Loaded', ruleCount, 'rules from', remappingPath);
      } catch (error) {
          logger.error(this._logKey, 'Remapping error:', error.message);
      }
  }

  parseVLCOpts(lines, currentIndex, extinf) {
      let i = currentIndex;
      
      // Debug per vedere il contenuto delle linee
      if (extinf.includes('tvg-name')) {
          const channelName = extinf.match(/tvg-name="([^"]+)"/) 
              ? extinf.match(/tvg-name="([^"]+)"/)[1]
              : 'Unknown channel';
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
          description: `Channel: ${cleanName} - ID: ${finalChannelId}`,
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
              name: 'No stream available in M3U playlists',
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
      const genres = new Set();
  
      let epgUrl = null;
      if (lines[0].includes('url-tvg=')) {
          const match = lines[0].match(/url-tvg="([^"]+)"/);
          if (match) {
              epgUrl = match[1].split(',').map(url => url.trim());
              logger.log(this._logKey, 'EPG URLs found in playlist:', epgUrl);
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
          logger.warn(this._logKey, 'Channels without playable streams:', this.channelsWithoutStreams.length);
          logger.log(this._logKey, 'Channels without streams:', this.channelsWithoutStreams.join(', '));
      }

      const channelsWithOnlyDummy = [];
      for (const [id, channel] of this.channelsMap.entries()) {
          if (channel.streamInfo.urls.length === 1 && 
              channel.streamInfo.urls[0].name === 'No stream available in M3U playlists') {
              channelsWithOnlyDummy.push(channel.name);
          }
      }

      if (channelsWithOnlyDummy.length > 0) {
          logger.log(this._logKey, 'Channels with dummy stream only:', channelsWithOnlyDummy.length, channelsWithOnlyDummy.join(', '));
      }

      return {
          genres: Array.from(genres),
          epgUrl
      };
  }

  async loadAndTransform(url, config = {}, sessionKey = null) {
      this._logKey = sessionKey || '_';
      try {
          await this.loadRemappingRules(config);
          
          const urlList = url.split(',').map(u => u.trim()).filter(u => u);
          logger.log(this._logKey, 'Playlist processing started, M3U URLs:', urlList.length);
          
          let playlistUrls = [];
          
          // Processa ogni URL fornito
          for (const singleUrl of urlList) {
              logger.log(this._logKey, 'Checking URL:', singleUrl);
              try {
                  const response = await axios.get(singleUrl);
                  const content = response.data;
                  
                  if (content.startsWith('#EXTM3U')) {
                      // È un file M3U diretto
                      playlistUrls.push(singleUrl);
                      logger.log(this._logKey, 'Direct M3U file found:', singleUrl);
                  } else {
                      const urls = content.split('\n').filter(line => line.trim() && line.startsWith('http'));
                      playlistUrls.push(...urls);
                      logger.log(this._logKey, 'URL list found, contains', urls.length, 'playlist(s)');
                  }
              } catch (error) {
                  logger.error(this._logKey, 'Error processing URL:', singleUrl, error.message);
                  // Continua con gli altri URL anche se uno fallisce
              }
          }

          logger.log(this._logKey, 'Total playlists to process:', playlistUrls.length);

          const allGenres = [];
          const allEpgUrls = new Set();
          
          for (const playlistUrl of playlistUrls) {
              logger.log(this._logKey, 'Processing playlist:', playlistUrl);
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
                      stream => stream.name !== 'No stream available in M3U playlists'
                  );
              }
          });

          logger.log(this._logKey, 'Processing summary: channels', finalResult.channels.length, ', genres', finalResult.genres.length, allEpgUrls.size > 0 ? ', EPG URLs ' + allEpgUrls.size : '', '- completed');

          this.channelsMap.clear();
          this.channelsWithoutStreams = [];
          return finalResult;

      } catch (error) {
          logger.error(this._logKey, 'Playlist error:', error.message);
          throw error;
      }
  }
}

module.exports = PlaylistTransformer;
