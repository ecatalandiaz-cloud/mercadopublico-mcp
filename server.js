/**
 * Servidor MCP propio sobre la API pública de Mercado Público (ChileCompra).
 *
 * Expone, como herramientas usables desde el chat de Claude, exactamente lo que la API
 * pública de api.mercadopublico.cl realmente soporta — ni más ni menos. En particular:
 *
 *   - SÍ se puede: buscar una licitación u orden de compra por su código exacto; listar
 *     todas las licitaciones/órdenes de compra de UN día específico (con filtro opcional
 *     por organismo, proveedor o estado); buscar el código de un proveedor a partir de su RUT.
 *
 *   - NO se puede (limitación real de la API pública, no de este servidor): pedir "todo el
 *     historial de un proveedor" en una sola consulta. El filtro por proveedor solo funciona
 *     combinado con una fecha puntual — para un historial habría que recorrer día por día,
 *     lo cual no es práctico para una consulta en vivo desde el chat. Si necesitas ese tipo
 *     de análisis histórico agregado, la alternativa realista es usar una herramienta que ya
 *     mantenga esa base construida con el tiempo (como LicitaLab), no replicarla aquí.
 *
 * Requiere tu propio ticket de la API (gratis, se pide en minutos) — ver README.md.
 */

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const TICKET = process.env.MERCADOPUBLICO_TICKET;
const BASE = "https://api.mercadopublico.cl/servicios/v1/publico";
const BASE_EMPRESAS = "https://api.mercadopublico.cl/servicios/v1/Publico/Empresas";

if (!TICKET) {
  console.error("Falta la variable de entorno MERCADOPUBLICO_TICKET. Ver README.md para obtener un ticket gratis.");
  process.exit(1);
}

// Convierte "2026-09-15" o "15-09-2026" al formato ddmmaaaa que exige la API.
function aFechaApi(fechaTexto) {
  const soloDigitos = String(fechaTexto).replace(/[^\d]/g, "");
  if (soloDigitos.length === 8 && String(fechaTexto).indexOf("-") === -1 && String(fechaTexto).indexOf("/") === -1) {
    // ya viene como ddmmaaaa u otro bloque de 8 dígitos sin separadores
    return soloDigitos;
  }
  const m = String(fechaTexto).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}${m[2]}${m[1]}`;
  const m2 = String(fechaTexto).match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m2) return `${m2[1]}${m2[2]}${m2[3]}`;
  throw new Error(`No entendí la fecha "${fechaTexto}". Usa AAAA-MM-DD (ej: 2026-09-15).`);
}

// ---------------- Extracción de la ficha web pública (no la API estructurada) ----------------
// Algunos organismos incrustan el texto completo de las Bases Administrativas y Técnicas
// directamente en la ficha web (probado con una licitación real del MOP) — otros solo
// referencian archivos PDF separados para descargar (probado con otra licitación real, de
// Pudahuel). Esta función funciona igual en ambos casos: si las bases vienen incrustadas,
// las extrae completas; si no, tieneBasesIncrustadas queda en false y hay que avisarle al
// usuario que baje los anexos manualmente y los suba al chat.

function extraerTextoPlano(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&Aacute;/g, "Á").replace(/&Eacute;/g, "É").replace(/&Iacute;/g, "Í")
    .replace(/&Oacute;/g, "Ó").replace(/&Uacute;/g, "Ú").replace(/&Ntilde;/g, "Ñ")
    .replace(/&aacute;/g, "á").replace(/&eacute;/g, "é").replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó").replace(/&uacute;/g, "ú").replace(/&ntilde;/g, "ñ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extraerSeccion(textoPlano, etiquetaInicio, etiquetaFin) {
  const inicio = textoPlano.indexOf(etiquetaInicio);
  if (inicio === -1) return null;
  const desdeInicio = textoPlano.slice(inicio + etiquetaInicio.length);
  const fin = etiquetaFin ? desdeInicio.indexOf(etiquetaFin) : -1;
  return (fin === -1 ? desdeInicio : desdeInicio.slice(0, fin)).trim();
}

function extraerFichaCompleta(html) {
  const texto = extraerTextoPlano(html);
  const codigoMatch = texto.match(/Licitaci[oó]n ID:\s*([A-Za-z0-9\-]+)/);
  const basesAdmin = extraerSeccion(texto, "BASES ADMINISTRATIVAS", "BASES TECNICAS");
  const basesTec = extraerSeccion(texto, "BASES TECNICAS", "Demandas ante el Tribunal de Contratación Pública");
  return {
    codigo: codigoMatch ? codigoMatch[1] : null,
    basesAdministrativas: basesAdmin,
    basesTecnicas: basesTec,
    tieneBasesIncrustadas: !!(basesAdmin || basesTec),
    textoCompleto: texto
  };
}

async function llamarApi(url) {
  const res = await fetch(url);
  const texto = await res.text();
  let datos;
  try { datos = JSON.parse(texto); } catch (e) {
    throw new Error(`La API no devolvió JSON válido (status ${res.status}). Respuesta: ${texto.slice(0, 300)}`);
  }
  if (!res.ok) {
    throw new Error(`La API respondió con error ${res.status}: ${JSON.stringify(datos).slice(0, 300)}`);
  }
  return datos;
}

const server = new McpServer({
  name: "mercadopublico-mcp",
  version: "1.0.0"
});

server.registerTool(
  "buscar_licitacion",
  {
    title: "Buscar licitación por código",
    description: "Trae los datos completos de UNA licitación específica de Mercado Público (Chile) a partir de su código exacto (ej: '1214102-55-LP26').",
    inputSchema: { codigo: z.string().describe("Código exacto de la licitación, ej: 1214102-55-LP26") }
  },
  async ({ codigo }) => {
    const datos = await llamarApi(`${BASE}/licitaciones.json?codigo=${encodeURIComponent(codigo)}&ticket=${TICKET}`);
    return { content: [{ type: "text", text: JSON.stringify(datos, null, 2) }] };
  }
);

server.registerTool(
  "buscar_licitaciones_del_dia",
  {
    title: "Listar licitaciones de un día",
    description: "Lista las licitaciones publicadas en UNA fecha específica. Puedes acotar por código de organismo comprador, código de proveedor, o estado. No permite rangos de fechas ni historial — es una foto de ese día puntual.",
    inputSchema: {
      fecha: z.string().describe("Fecha a consultar, formato AAAA-MM-DD (ej: 2026-09-15)"),
      codigoOrganismo: z.string().optional().describe("Código del organismo comprador (usa buscar_organismo para encontrarlo)"),
      codigoProveedor: z.string().optional().describe("Código del proveedor (usa buscar_proveedor para encontrarlo a partir de su RUT)"),
      estado: z.enum(["publicada", "cerrada", "desierta", "adjudicada", "revocada", "suspendida", "todos"]).optional().describe("Filtra por estado de la licitación")
    }
  },
  async ({ fecha, codigoOrganismo, codigoProveedor, estado }) => {
    const params = new URLSearchParams({ fecha: aFechaApi(fecha), ticket: TICKET });
    if (codigoOrganismo) params.set("CodigoOrganismo", codigoOrganismo);
    if (codigoProveedor) params.set("CodigoProveedor", codigoProveedor);
    if (estado) params.set("estado", estado);
    const datos = await llamarApi(`${BASE}/licitaciones.json?${params.toString()}`);
    return { content: [{ type: "text", text: JSON.stringify(datos, null, 2) }] };
  }
);

server.registerTool(
  "buscar_orden_compra",
  {
    title: "Buscar orden de compra por código",
    description: "Trae los datos completos de UNA orden de compra específica de Mercado Público a partir de su código exacto.",
    inputSchema: { codigo: z.string().describe("Código exacto de la orden de compra, ej: 2097-241-SE14") }
  },
  async ({ codigo }) => {
    const datos = await llamarApi(`${BASE}/ordenesdecompra.json?codigo=${encodeURIComponent(codigo)}&ticket=${TICKET}`);
    return { content: [{ type: "text", text: JSON.stringify(datos, null, 2) }] };
  }
);

server.registerTool(
  "buscar_ordenes_compra_del_dia",
  {
    title: "Listar órdenes de compra de un día",
    description: "Lista las órdenes de compra emitidas en UNA fecha específica. Puedes acotar por código de organismo, código de proveedor, o estado. Misma limitación que las licitaciones: es una foto de ese día, no un historial.",
    inputSchema: {
      fecha: z.string().describe("Fecha a consultar, formato AAAA-MM-DD (ej: 2026-09-15)"),
      codigoOrganismo: z.string().optional().describe("Código del organismo comprador"),
      codigoProveedor: z.string().optional().describe("Código del proveedor (usa buscar_proveedor para encontrarlo a partir de su RUT)"),
      estado: z.string().optional().describe("Código de estado — ej. 4=Enviada a Proveedor, 6=Aceptada, 9=Cancelada, 12=Recepción Conforme")
    }
  },
  async ({ fecha, codigoOrganismo, codigoProveedor, estado }) => {
    const params = new URLSearchParams({ fecha: aFechaApi(fecha), ticket: TICKET });
    if (codigoOrganismo) params.set("CodigoOrganismo", codigoOrganismo);
    if (codigoProveedor) params.set("CodigoProveedor", codigoProveedor);
    if (estado) params.set("estado", estado);
    const datos = await llamarApi(`${BASE}/ordenesdecompra.json?${params.toString()}`);
    return { content: [{ type: "text", text: JSON.stringify(datos, null, 2) }] };
  }
);

server.registerTool(
  "buscar_proveedor",
  {
    title: "Buscar código de proveedor por RUT",
    description: "Dado el RUT de una empresa (con puntos, guion y dígito verificador), devuelve su código y razón social en Mercado Público. Ese código es el que se usa después en codigoProveedor para filtrar licitaciones u órdenes de compra de un día puntual.",
    inputSchema: { rut: z.string().describe("RUT de la empresa, con puntos y guion, ej: 78.417.124-8") }
  },
  async ({ rut }) => {
    const datos = await llamarApi(`${BASE_EMPRESAS}/BuscarProveedor?rutempresaproveedor=${encodeURIComponent(rut)}&ticket=${TICKET}`);
    return { content: [{ type: "text", text: JSON.stringify(datos, null, 2) }] };
  }
);

server.registerTool(
  "buscar_organismo",
  {
    title: "Buscar organismos públicos compradores",
    description: "Devuelve el listado completo de organismos públicos (compradores) de Mercado Público, con su código y nombre — para encontrar el código de uno en particular, busca su nombre en el texto devuelto.",
    inputSchema: {}
  },
  async () => {
    const datos = await llamarApi(`${BASE_EMPRESAS}/BuscarComprador?ticket=${TICKET}`);
    return { content: [{ type: "text", text: JSON.stringify(datos, null, 2) }] };
  }
);

server.registerTool(
  "obtener_ficha_completa",
  {
    title: "Obtener ficha completa de una licitación (incluye bases si están incrustadas)",
    description: "Trae la ficha web pública de una licitación (no la API estructurada) y busca si el organismo incrustó el texto completo de las Bases Administrativas y Técnicas directamente en la página. Cuando sí vienen incrustadas, las devuelve completas, listas para analizar. Cuando no (algunos organismos solo referencian archivos PDF separados para descargar), lo indica explícitamente — en ese caso, pide a la persona que descargue esos anexos desde la ficha y los suba directo al chat para analizarlos.",
    inputSchema: { codigo: z.string().describe("Código exacto de la licitación, ej: 1459-19-LE26") }
  },
  async ({ codigo }) => {
    const url = `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(codigo)}`;
    const res = await fetch(url);
    if (!res.ok) {
      return { content: [{ type: "text", text: `No se pudo obtener la ficha (status ${res.status}). Verifica el código.` }] };
    }
    const html = await res.text();
    const datos = extraerFichaCompleta(html);
    if (!datos.tieneBasesIncrustadas) {
      return { content: [{ type: "text", text: `Esta licitación (${codigo}) no trae las bases incrustadas en la ficha web — este organismo usa archivos PDF separados. Pide a la persona que los descargue desde https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(codigo)} (sección "Antecedentes para incluir en la oferta") y los suba directo al chat para analizarlos.` }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(datos, null, 2) }] };
  }
);

// ---------------- Transporte HTTP (streamable-http, el que usa Claude.ai) ----------------

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const PUERTO = process.env.PORT || 3000;
app.listen(PUERTO, () => {
  console.log(`Servidor MCP de Mercado Público escuchando en el puerto ${PUERTO}`);
});
