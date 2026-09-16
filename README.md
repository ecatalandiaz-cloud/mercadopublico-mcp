# Servidor MCP — Mercado Público (ChileCompra)

Servidor propio, construido sobre la **API pública** de api.mercadopublico.cl y la **ficha web pública** — no usa ni copia código de LicitaLab ni de ninguna otra plataforma de pago. Expone 7 herramientas para consultar licitaciones, órdenes de compra, proveedores, y —cuando el organismo las incrustó en la ficha— las bases administrativas y técnicas completas, directamente desde el chat de Claude, sin pasar por el dashboard.

## ⚠️ Qué puede hacer, y qué NO

**Sí puede:**
- Buscar una licitación u orden de compra exacta por su código.
- Listar todas las licitaciones/órdenes de compra de **un día puntual**, filtrando por organismo, proveedor o estado.
- Buscar el código de un proveedor a partir de su RUT.
- Traer el texto completo de las Bases Administrativas y Técnicas de una licitación, **cuando el organismo las incrustó en la ficha web** (confirmado con un caso real del MOP) — ver el detalle más abajo.

**No puede** (limitación real de la API pública de Mercado Público, no de este servidor):
- Traer "todo el historial de un proveedor" en una sola consulta. El filtro por proveedor solo funciona combinado con una fecha específica — para armar un historial habría que recorrer día por día, lo cual no es viable para una consulta en vivo desde el chat.
- Si necesitas ese tipo de análisis histórico agregado (competidores, tasa de adjudicación en el tiempo), la alternativa realista es una herramienta que ya mantenga esa base construida con el tiempo — no algo que este servidor pueda ofrecer de forma instantánea.

## La 7ª herramienta — análisis de bases (con un límite real, probado)

`obtener_ficha_completa` trae la **ficha web pública** (no la API estructurada) y busca si el organismo incrustó el texto completo de las Bases Administrativas y Técnicas directo en la página. Esto se probó con una licitación real del MOP (1459-19-LE26) donde sí venían incrustadas — pero **no todos los organismos lo hacen así**: otra licitación real que revisamos (de la CODEP, Pudahuel) solo traía archivos PDF separados para descargar. La herramienta detecta ambos casos: si no encuentra las bases incrustadas, te lo dice explícitamente y sugiere subir los PDFs directo al chat en su lugar.

**Importante sobre cómo se probó esto:** el entorno donde se escribió este servidor no tenía acceso a internet saliente, así que la lógica de extracción se probó contra una reconstrucción fiel del HTML real (ya verificado antes con `web_fetch`), no contra una llamada en vivo al sitio. La lógica de extracción en sí quedó verificada y corregida (se encontró y arregló un bug real de acentos durante la prueba) — pero **antes de confiar en esto en producción, pruébala tú una vez contra una licitación real** que sepas que trae bases incrustadas, para confirmar que el fetch en vivo funciona igual que la simulación.

## Requisitos

1. **Node.js 18 o superior.**
2. **Tu propio ticket de la API de Mercado Público** — gratis, se pide en minutos:
   1. Activa tu Clave Única en [claveunica.gob.cl](https://claveunica.gob.cl) (si no la tienes).
   2. Entra a [api.mercadopublico.cl/modules/IniciarSesion.aspx](https://api.mercadopublico.cl/modules/IniciarSesion.aspx) → "Pide tu ticket" → inicia sesión con tu Clave Única.
   3. El ticket llega a tu correo. Permite hasta 10.000 consultas diarias.

## Instalación local (para probarlo antes de desplegarlo)

```bash
npm install
export MERCADOPUBLICO_TICKET="tu-ticket-aqui"
npm start
```

El servidor queda escuchando en `http://localhost:3000/mcp`.

## Desplegarlo para que Claude pueda conectarse

Claude.ai necesita una URL pública (con HTTPS) para conectarse a un conector personalizado — no puede conectarse a `localhost`. Opciones sencillas y gratuitas/económicas para partir:

- **[Render](https://render.com)** — "New Web Service", conecta este repositorio, agrega la variable de entorno `MERCADOPUBLICO_TICKET`, y el comando de inicio `npm start`.
- **[Railway](https://railway.app)** — mismo proceso, con despliegue desde GitHub.
- **[Fly.io](https://fly.io)** — requiere un poco más de configuración (`fly launch`), pero tiene capa gratuita.

Cualquiera de estas te da una URL pública del tipo `https://tu-servidor.onrender.com` — la URL del servidor MCP para Claude sería esa más `/mcp` al final.

## Conectarlo a Claude

1. En claude.ai, ve a **Settings → Connectors**.
2. Agrega un conector personalizado ("Add custom connector").
3. Pega la URL: `https://tu-servidor-desplegado.com/mcp`.
4. Una vez conectado, puedes pedirle a Claude directamente cosas como "busca la licitación 1214102-55-LP26" o "¿cuál es el código de proveedor del RUT 78.417.124-8?", y Claude va a usar estas herramientas automáticamente.

## Importante — seguridad de tu ticket

Tu ticket queda guardado como variable de entorno en el servidor, nunca en el código ni expuesto al navegador. No lo compartas ni lo subas a un repositorio público.

## Nota sobre pruebas

Este código fue escrito y verificado en sintaxis, pero **no se pudo instalar ni ejecutar en el entorno donde se generó** (sin acceso a internet para descargar las dependencias). La lógica de extracción de la 7ª herramienta sí se probó, contra datos reales capturados con `web_fetch`. Antes de desplegarlo en producción, pruébalo primero en local con `npm install && npm start`, y revisa que las 7 herramientas respondan bien con un código de licitación real que ya conozcan (por ejemplo, alguno de los que hemos usado en esta conversación).
