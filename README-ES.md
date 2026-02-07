# 📺 OMG Premium TV para Stremio

***[🇮🇹 Leggi in italiano](README.md)*** - ***[🇬🇧 Read in English](README-EN.md)*** - ***[🇫🇷 Lire en Français](README-FR.md)*** - ***[🇪🇸 Leer en español](README-ES.md)***

## 👋 Introducción

Bienvenido a OMG Premium TV, el addon para Stremio que te permite ver tus canales de TV e IPTV favoritos desde listas de reproducción M3U/M3U8, enriquecidas con información sobre programas (EPG). Esta guía te ayudará a aprovechar al máximo todas las funcionalidades disponibles.

<img width="1440" alt="Screenshot 2025-02-28 alle 21 36 52" src="https://github.com/user-attachments/assets/c85b2a33-0174-4cb3-b7a9-2cc2140c8c0f" />

### ⚠️ ¡Lee con atención!

Trabajar en este addon y mantenerlo actualizado ha costado muchísimas horas y muchísimo esfuerzo ❤️
¡Un café ☕ o una cerveza 🍺 son un gesto de reconocimiento muy apreciado y me ayudan a continuar y mantener activo este proyecto!

**¡Con una donación serás añadido a un grupo de Telegram dedicado donde recibirás en primicia las nuevas versiones! ¡Te espero!**

<a href="https://www.buymeacoffee.com/mccoy88f"><img src="https://img.buymeacoffee.com/button-api/?text=Invítame a una cerveza&emoji=🍺&slug=mccoy88f&button_colour=FFDD00&font_colour=000000&font_family=Bree&outline_colour=000000&coffee_colour=ffffff" /></a>

[También puedes invitarme a una cerveza con PayPal 🍻](https://paypal.me/mccoy88f?country.x=ES&locale.x=es_ES)




## 🔄 Registro de cambios de OMG Premium TV

### 🚀 Versión 7.0.0 (Actual)

### ✨ Nuevas funcionalidades
- **🔒 Protección por contraseña de la home**: Opción en la interfaz web para proteger el acceso a la página de configuración con una contraseña. Si está activa, quien abra la home (o el enlace «Configurar» desde Stremio) debe introducir la contraseña; el uso del addon desde Stremio no requiere contraseña.
- **🔄 Sesiones y caché aislada**: La caché se aísla automáticamente por configuración (misma config = misma caché). EPG, Resolver Python y Generador de playlist son también por sesión. Varios usuarios o configuraciones distintas pueden usar el servidor a la vez sin pisarse.
- **🆔 ID de sesión**: En home/config se muestra el **ID de sesión** (derivado de la configuración) cuando generas una configuración. El ID se incluye también en el backup (exportar) y se actualiza al restaurar (importar).
- **⏰ Caducidad de sesiones (24h)**: Si una sesión no recibe peticiones durante **24 horas**, caduca automáticamente: se elimina toda la caché de esa sesión (caché M3U, EPG, resolver, generador). En la siguiente petición con la misma config la sesión se recrea y los datos se rellenan desde las URL.

### 🔧 Mejoras
- **🌐 Interfaz en 4 idiomas**: La interfaz web está disponible en italiano, inglés, español y francés; puedes cambiar el idioma desde la barra superior derecha.
- **⚙️ Sección Ajustes**: En el catálogo hay un filtro por género **⚙️** que agrupa los canales de utilidad: **Refresh M3U playlist**, **Refresh EPG** y **Rigenera Playlist Python**. Descripciones y mensajes en inglés.
- **🔄 Pseudo-canales**: Al abrir un canal de la sección ⚙️ se ejecuta la acción (recargar playlist, actualizar EPG o regenerar Python) y se muestra un mensaje de resultado; no hay flujo de vídeo real.
- **♻️ Caché al reiniciar**: Si la caché está vacía (p. ej. tras reiniciar Docker), la playlist y el EPG se reconstruyen automáticamente en la primera petición cuando hay URL M3U/EPG configurados.
- **📺 EPG e ID de canales**: Mejor emparejamiento EPG para canales con sufijo (p. ej. `canale5.it` / `canale5`).
- **🔒 Interfaz de protección**: Con la protección activa se ve la casilla y el botón «Modifica password»; los campos de contraseña y confirmación solo aparecen al pulsarlo.
- **🔗 Vuelta tras el login**: Tras introducir la contraseña en la pantalla de acceso se redirige a la página desde la que se entró (p. ej. página de configuración con URL codificada).

### 🚀 Versión 6.0.0

### 📢 Cambio de nombre
- **📜 OMG+ se convierte en OMG Premium**: Nuevo nombre para diferenciar y valorizar todas las nuevas funciones disponibles. OMG TV permanece como versión básica con canales preestablecidos. No se actualizará más.

### ✨ Nuevas funcionalidades
- **🐍 Resolver Python**: Sistema completo para resolver URLs de streaming mediante scripts Python personalizables
- **🔄 Canal de regeneración**: Nuevo canal en la categoría ~SETTINGS~ para regenerar la lista de reproducción sin acceder al panel web
- **🛠️ Backup y restauración**: Sistema para guardar y restaurar la configuración completa
- **🔧 Template resolver**: Funcionalidad para crear automáticamente plantillas de scripts resolver personalizables
- **👤 User-Agent avanzado**: Gestión mejorada de las cabeceras User-Agent, Referer y Origin
- **🧩 Módulos Python**: Soporte integrado para request y otros módulos Python para scripts avanzados

### 🔧 Mejoras
- **🐳 Soporte Docker mejorado**: Configuraciones optimizadas para Hugging Face y Portainer
- **♻️ Caché inteligente**: Sistema de caché completamente rediseñado con rendimiento mejorado
- **🔄 Actualización programada**: Control preciso del intervalo de actualización en formato HH:MM
- **📋 Interfaz web renovada**: Panel de configuración más intuitivo y rico en funcionalidades
- **⚡ Streaming optimizado**: Mejor gestión del fallback entre proxy y streams directos
- **🛡️ Gestión de errores robusta**: Sistema mejorado de gestión de errores e intentos múltiples

### 🐛 Correcciones
- **🔄 Solucionado el bucle infinito**: Corregido el problema del bucle infinito con resolver y proxy activos
- **🔌 Mejorada compatibilidad**: Resueltos problemas de compatibilidad con diferentes tipos de listas de reproducción
- **🧰 Corrección de cabeceras HTTP**: Corregida la gestión de las cabeceras HTTP personalizadas
- **🔍 Corrección búsqueda de canales**: Mejorada la búsqueda de canales por correspondencia parcial
- **📊 Optimización EPG**: Resueltos problemas con EPG de gran tamaño

## 📝 Notas de actualización
- Las configuraciones anteriores NO son compatibles con las instalaciones de OMG TV y OMG+ TV.
- Se recomienda realizar una nueva instalación desde cero en Hugging Face o en VPS (recomendado Portainer)
- Para aprovechar las funcionalidades del resolver Python, es necesario configurarlo en la sección avanzada

Para detalles completos sobre el funcionamiento de las nuevas funcionalidades, consulta el manual de usuario actualizado.

## 🚀 Empecemos: Instalación

### 🐳 Despliegue en DOCKER
- Para poder proceder primero debes hacer la instalación mediante docker en Hugging Face o en VPS.
- [Sigue la guía aquí](docker-install-es.md) y luego vuelve a esta página una vez que esté disponible el sitio web de tu addon.
- Si todas estas cosas te parecen incomprensibles DETENTE; busca una guía en línea sobre docker, mira la sección de soporte al final de esta página o pide ayuda a una IA 😊

### 📲 Instalación del addon
1. Abre la página web de configuración OMG Premium TV
2. Configura el addon según tus necesidades
3. Haz clic en el botón **INSTALAR EN STREMIO** 🔘
4. Stremio se abrirá automáticamente y te pedirá que confirmes la instalación
5. Haz clic en **Instalar** ✅

## ⚙️ Configuración básica

### 📋 Configuración de la lista de reproducción
- **URL M3U** 📋: Introduce la URL de tu lista de reproducción M3U/M3U8
  - *Ejemplo único*: `http://example.com/playlist.m3u`
  - *Ejemplo múltiple*: `http://example.com/playlist1.m3u,http://example.com/playlist2.m3u`
  - 💡 **Novedad**: Puedes introducir múltiples URLs M3U separándolas con comas (,) para combinar varias listas de reproducción

### 📊 Configuración EPG
- **URL EPG** 📊: Introduce la URL del archivo EPG (guía electrónica de programas)
  - *Ejemplo único*: `http://example.com/epg.xml` o `http://example.com/epg.xml.gz`
  - *Ejemplo múltiple*: `http://example.com/epg1.xml,http://example.com/epg2.xml`
  - 💡 **Novedad**: Puedes introducir múltiples URLs EPG separándolas con comas (,) para combinar varias guías de programas
- **Habilitar EPG** ✅: Marca esta casilla para visualizar la información sobre los programas

## 🔍 Uso del addon

### 📱 Navegación en el catálogo
1. Abre Stremio
2. Ve a la sección **Descubrir** 🔍
3. Selecciona **Canales TV** y luego **OMG Premium TV** de la lista de addons
4. Verás la lista completa de los canales disponibles

### 🎯 Filtrado de canales
- **Por género** 🏷️: Selecciona un género del menú desplegable para filtrar los canales
- **Búsqueda** 🔍: Usa la función de búsqueda para encontrar canales específicos por nombre

### 🎬 Visualización de los detalles del canal
Haz clic en un canal para ver:
- 📋 Información sobre el canal
- 📺 Programa actualmente en emisión (si EPG está habilitado)
- 🕒 Próximos programas (si EPG está habilitado)
- 🏷️ Categorías del canal

### ▶️ Reproducción de un canal
- Haz clic en el canal y luego en el botón **WATCH** ▶️
- Elige entre las opciones de stream disponibles:
  - 📺 **Stream Original**: El stream estándar de la lista de reproducción
  - 🌐 **Stream Proxy**: El stream a través de un proxy (mayor compatibilidad)
  - 🧩 **Stream Resuelto**: El stream procesado por un script resolver (para canales especiales)

## 🛠️ Configuración avanzada

### 🔒 Proteger acceso a la home
- **Habilitar protección con contraseña** ✅: Si está activa, en la próxima visita a la página de configuración (home o enlace «Configurar» desde Stremio) se pedirá la contraseña. El addon en Stremio sigue funcionando sin contraseña.
- **Modificar contraseña**: Con la protección activa verás «Protezione attiva» y el botón **Modifica password**; al pulsarlo aparecen los campos para cambiar la contraseña. Para desactivar la protección, desmarca la casilla y guarda (sin escribir contraseña).
- La contraseña se establece y se cambia solo desde la interfaz web; no se pide para ver canales en Stremio.

### 🌐 Configuración proxy
- **URL Proxy** 🔗: URL del proxy para los streams (es compatible solo con [MediaFlow Proxy](https://github.com/mhdzumair/mediaflow-proxy))
- **Contraseña Proxy** 🔑: Contraseña para la autenticación del proxy
- **Forzar Proxy** ✅: Obliga a todos los streams a utilizar el proxy

### 🆔 Gestión de ID y actualizaciones
- **Sufijo ID** 🏷️: Añade un sufijo a los ID de los canales sin id en la lista de reproducción (ej. `.es`)
- **Ruta archivo remapper** 📝: Especifica un archivo para el remapeo de los ID EPG
- **Intervalo Actualización** ⏱️: Especifica con qué frecuencia actualizar la lista de reproducción (formato `HH:MM`)

## 🐍 Funcionalidades Python avanzadas

### 🔄 Generación de lista de reproducción con script Python
1. **URL del Script Python** 🔗: Introduce la URL del script Python
2. **DESCARGAR SCRIPT** 💾: Descarga el script en el servidor
3. **EJECUTAR SCRIPT** ▶️: Ejecuta el script para generar la lista de reproducción
4. **USAR ESTA LISTA** ✅: Utiliza la lista de reproducción generada como fuente

### ⏱️ Actualización automática
- Introduce el intervalo deseado (ej. `12:00` para 12 horas)
- Haz clic en **PROGRAMAR** 📅 para activar las actualizaciones automáticas
- Haz clic en **DETENER** ⏹️ para desactivar las actualizaciones

### 🧩 Configuración Resolver Python
- **URL Script Resolver** 🔗: Introduce la URL del script resolver
- **Habilitar Resolver Python** ✅: Activa el uso del resolver
- **DESCARGAR SCRIPT** 💾: Descarga el script resolver
- **CREAR TEMPLATE** 📋: Crea una plantilla de script resolver para personalizar
- **VERIFICAR SCRIPT** ✅: Comprueba que el script resolver funcione correctamente
- **LIMPIAR CACHÉ** 🧹: Vacía la caché del resolver

## 💾 Backup y restauración

### 📤 Backup configuración
1. Haz clic en **BACKUP CONFIGURACIÓN** 💾
2. Se descargará un archivo JSON con todos tus ajustes (incluido el **ID de sesión** de la config actual)

### 📥 Restauración configuración
1. Haz clic en **RESTAURAR CONFIGURACIÓN** 📤
2. Selecciona el archivo JSON previamente guardado
3. Espera a que se complete la restauración (el ID de sesión en la página se actualiza según la config restaurada)

## ❓ Resolución de problemas

### ⚠️ Streams que no funcionan
- Prueba a activar la opción **Forzar Proxy** ✅
- Verifica que la URL de la lista de reproducción sea correcta
- Intenta utilizar un script resolver Python para canales problemáticos

### 📊 Problemas con EPG
- Verifica que la URL del EPG sea correcta
- Comprueba que la opción **Habilitar EPG** ✅ esté activada
- Asegúrate de que los ID de los canales coincidan entre la lista de reproducción y el EPG

### 🐍 Problemas con scripts Python
- Comprueba que Python esté instalado en el servidor del addon
- Verifica el estado del script en la sección **Estado Script Python**
- Intenta descargar nuevamente el script

## 🔄 Actualizaciones y mantenimiento

### 🔄 Modificación de la configuración
- En Stremio, ve a **Configuración** ⚙️ > **Addon**
- Haz clic en **Configurar** 🔄 junto a OMG Premium TV
- Accede a la página de configuración, haz los cambios que te interesen
- Presiona **Generar Configuración**
- Para evitar un duplicado, elimina el addon en Stremio
- Vuelve a la página de configuración y haz clic en **Instalar en Stremio**

### 🔧 Regeneración de lista y actualizaciones rápidas
- En la sección **⚙️** (filtro por género del catálogo): **Refresh M3U playlist** (recargar desde la fuente), **Refresh EPG** (actualizar guía), **Rigenera Playlist Python** (ejecutar script y recargar). Abre el canal y sigue el mensaje en pantalla.

## 📋 Resumen de las principales funcionalidades

- ✅ Soporte para listas de reproducción M3U/M3U8
- ✅ Soporte para guías de programas EPG (XMLTV)
- ✅ Filtros por género y búsqueda
- ✅ Proxy para mayor compatibilidad
- ✅ Resolver Python para streams especiales
- ✅ Generación de listas de reproducción personalizadas
- ✅ Actualizaciones automáticas
- ✅ Backup y restauración de configuración
- ✅ Protección por contraseña de la página de configuración (opcional)
- ✅ Caché aislada por configuración (accesos simultáneos)
- ✅ ID de sesión visible e incluido en exportar/importar
- ✅ Caducidad automática de sesiones inactivas (24h) para liberar espacio
- Especificaciones técnicas en la [wiki](https://github.com/mccoy88f/OMG-Premium-TV/wiki/Tech-Spec-%E2%80%90-Specifiche-Teniche)

## 📱 Compatibilidad

OMG PremTV funciona en todas las plataformas soportadas por Stremio:
- 💻 Windows
- 🍎 macOS
- 🐧 Linux
- 📱 Android
- 📱 iOS (a través del navegador web)
- 📺 Android TV
- 📺 Apple TV

## 👥 Comunidad
- Si buscas soporte, guías o información sobre el mundo OMG, MediaFlow Proxy y Stremio puedes visitar:
- [Reddit (Team Stremio Italia)](https://www.reddit.com/r/Stremio_Italia/)
- [Grupo de Telegram](http:/t.me/Stremio_ITA)

## 👏 Agradecimientos
- FuriousCat por la idea del nombre OMG
- Equipo de Stremio Italia
- Comunidad de Telegram (ver sección Comunidad)
- Iconic Panda por el [icono](https://www.flaticon.com/free-icon/tv_18223703?term=tv&page=1&position=2&origin=tag&related_id=18223703)
- [Vídeo de fondo](https://it.vecteezy.com/video/1803236-no-signal-bad-tv) del frontend y para los flujos dummy creado por igor.h (en Vecteezy)

## 📜 Licencia
Proyecto publicado bajo licencia MIT.


---

📚 **Nota importante**: OMG Premium TV está diseñado para acceder a contenidos legales. En el addon no se incluyen canales ni flujos. Asegúrate de respetar la normativa de tu país respecto al streaming de contenidos.

🌟 ¡Gracias por elegir OMG Premium TV! ¡Disfruta de la visión! 🌟
