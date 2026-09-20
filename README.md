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

`obtener_ficha_completa` trae la **ficha web pública** (no la API estructurada) y busca si el organismo incrustó el texto completo de las Bases Administrativas y Técnicas directo en la página. La herramienta detecta ambos casos: si no encuentra las bases incrustadas, te lo dice explícitamente y sugiere subir los PDFs directo al chat en su lugar.

**Patrón observado con casos reales, comparando varios organismos y tipos de licitación** (muestra pequeña — 5 casos — no es una regla garantizada, pero da una idea de qué esperar):

| Licitación | Organismo | Tipo | ¿Bases incrustadas? |
|---|---|---|---|
| Barreras Metálicas | MOP / Vialidad | LE | ✅ Sí, completas |
| UX-UI Portal ClaveÚnica | SEGPRES (ministerial) | LQ (monto alto) | ✅ Sí, completas |
| Concesión Aparcadero | Municipalidad de Maule | LE | ❌ No — ni siquiera pide archivo ("a través de este medio") |
| Uniformes institucionales | CODEP, Pudahuel (municipal) | LP | ❌ PDF separados para descargar |
| 5019-13-LE26 | — | LE | ❌ No incrustadas |

**La tendencia que se empieza a ver**: organismos centrales/ministeriales grandes tienden a incrustar las bases completas en la ficha. Municipalidades y licitaciones de menor monto tienden a usar PDF separados, o directamente no piden ningún archivo (se llena todo en el portal). Si le preguntas a Claude por una licitación y esta herramienta no encuentra las bases incrustadas, lo más probable es que sea de este segundo grupo — en ese caso, el camino es descargar el PDF manualmente y subirlo al chat.

### Por qué no se intentó automatizar también la descarga de esos PDF separados

Se investigó en serio esta posibilidad, inspeccionando en vivo el DOM real de una licitación con anexos nombrados (Lo Barnechea Servicios, GPS de flota, enero 2026) con el navegador integrado — buscando específicamente algún `__doPostBack` u otro enlace detrás de los nombres de los anexos. **Resultado confirmado, no supuesto**: la página que usa esta herramienta (`DetailsAcquisition.aspx`, identificada internamente como "FichaLight" por su carpeta de imágenes) no contiene ningún mecanismo de descarga para esos anexos — ni enlaces, ni postbacks, ni imágenes asociadas. Los nombres de los anexos aparecen como texto plano puro, sin ningún elemento interactivo alrededor.

En otras palabras: no es que el mecanismo exista y no se haya encontrado el patrón correcto — se confirmó que, en esta vista específica del sitio, simplemente no hay nada que replicar. Si en algún momento se identifica la URL de una ficha "completa" (no "Light") que sí incluya esos enlaces, vale la pena retomar esta investigación desde ahí.

### Lo que sí se construyó en su lugar: un checklist exacto, no un "ve y revisa"

Como no se puede automatizar la descarga, se construyó la siguiente mejor opción: cuando no hay bases incrustadas, la herramienta lee igual la sección "4. Antecedentes para incluir en la oferta" y extrae los **nombres exactos** de cada anexo pedido (administrativos, técnicos, económicos) — para que la persona sepa precisamente qué buscar en la ficha, en vez de tener que leerla completa ella misma. También distingue el caso en que la licitación **no pide ningún archivo** (cuando dice "a través de este medio", se llena directo en el portal) — ahí ni siquiera hay que descargar nada, y la herramienta lo aclara para no mandar a nadie a buscar algo que no existe.

Esto se probó con datos reales de la licitación de Lo Barnechea (7 anexos: 4 administrativos, 2 técnicos, 1 económico) y con el caso "a través de este medio" — en el proceso se encontraron y corrigieron dos bugs reales: el número de la sección siguiente se colaba en el último ítem de cada categoría, y las licitaciones sin archivo se contaban igual como si lo requirieran. Ambos quedaron corregidos y reverificados contra los mismos datos.

**Importante sobre cómo se probó esto:** el entorno donde se escribió este servidor no tenía acceso a internet saliente, así que la lógica de extracción se probó contra reconstrucciones fieles del HTML real (ya verificado antes con `web_fetch`), no contra una llamada en vivo al sitio. La lógica en sí quedó verificada y corregida — pero **antes de confiar en esto en producción, pruébala tú una vez contra una licitación real** que sepas que trae bases incrustadas y otra que no, para confirmar que el fetch en vivo funciona igual que la simulación.

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
