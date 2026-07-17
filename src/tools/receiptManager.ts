/**
 * Receipt Manager for Algorand Remote MCP
 *
 * Renders the GoPlausible "Universal Receipt" card (see .notes/design_handoff_universal_receipt)
 * covering TXN, x402, MPP, AP2 and UCP receipt categories.
 */
import { PhotonImage, watermark } from "@cf-wasm/photon";
import { generate } from "@juit/qrcode";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBgPng } from "../logoUrl";
import type { Env, Props } from "../types";
import { ResponseProcessor } from "../utils";

const RECEIPT_CATEGORIES = ["TXN", "x402", "MPP", "AP2", "UCP"] as const;
type ReceiptCategory = (typeof RECEIPT_CATEGORIES)[number];

const LOGOTYPE_URL =
	"https://goplausible.mypinata.cloud/ipfs/QmWjvCGPyL9zmA5B84WPqLYF27dL2nFgr1Lw6rMd7CpQPV/images/goPlausible-logo-type-h.png";
const LOGO_MARK_URL = "https://goplausible.com/logo64.png";
const OG_IMAGE_URL = "https://goplausible.com/og-image.png";
const FAVICON_URL = "https://goplausible.com/logo32.png";

const CHECK_CIRCLE_SVG = `<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8.2" fill="#2E7D32"></circle><path d="M5.2 9.3 L7.8 11.9 L12.8 6.4" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;

const ALGO_CHIP_MARK_SVG = `<svg width="13" height="13" viewBox="0 0 240 240"><path d="M230 214 h-24.3 l-15.8-58.8 -34 58.8 H128.7 l52.5-91 -8.4-31.5 -70.7 122.6 H74.9 L164.5 26 h21.3 l10.4 38.6 h24.5 l-16.7 29 Z" fill="#1E140D"></path></svg>`;

const ALGO_LOGO_SVG = `<svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#1E140D"></circle><path d="M28.8 29 h-3.2 l-2.1-7.8 -4.5 7.8 h-3.6 l7-12.1 -1.1-4.2 -9.4 16.3 h-3.6 L20.2 8.3 h2.8 l1.4 5.1 h3.3 l-2.2 3.9 3.3 11.7 Z" fill="#FFFFFF"></path></svg>`;

const USDC_LOGO_SVG = `<svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#2775CA"></circle><path d="M20 8.5c-1 0-1.7.8-1.7 1.7v.9c-3 .5-5 2.4-5 5 0 3.1 2.6 4.2 5.4 5l.9.3c2.4.7 3.4 1.2 3.4 2.5 0 1.4-1.3 2.3-3 2.3-1.9 0-3-.8-3.4-2-.3-.8-.9-1.3-1.7-1.3-1.1 0-1.9 1-1.6 2 .6 2.2 2.4 3.7 5 4.2v.9c0 1 .8 1.7 1.7 1.7 1 0 1.7-.8 1.7-1.7v-.9c3.1-.5 5.2-2.5 5.2-5.2 0-3.2-2.6-4.3-5.7-5.2l-.8-.2c-2.2-.6-3.2-1.1-3.2-2.3 0-1.3 1.2-2.1 2.8-2.1 1.5 0 2.5.6 3 1.6.4.7 1 1.2 1.8 1.2 1.1 0 1.9-1.1 1.5-2.1-.7-1.9-2.4-3.2-4.6-3.6v-1c0-1-.8-1.7-1.7-1.7z" fill="#FFFFFF"></path></svg>`;

const ASA_LOGO_SVG = `<svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#6B5E52"></circle><text x="20" y="25" text-anchor="middle" font-family="Sora,sans-serif" font-weight="800" font-size="12" fill="#FFFFFF">ASA</text></svg>`;

const GOOGLE_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20H24v8.5h11.3C33.7 33.7 29.3 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.3 0 6.3 1.2 8.6 3.3l6-6C34.9 4.7 29.7 2.5 24 2.5 12.1 2.5 2.5 12.1 2.5 24S12.1 45.5 24 45.5c11 0 21-8 21-21.5 0-1.4-.2-2.7-.4-4z"></path><path fill="#FF3D00" d="M5 14.7l7 5.1C13.8 15.6 18.5 11 24 11c3.3 0 6.3 1.2 8.6 3.3l6-6C34.9 4.7 29.7 2.5 24 2.5 15.6 2.5 8.4 7.4 5 14.7z"></path><path fill="#C96F3F" d="M24 45.5c5.6 0 10.7-2.1 14.5-5.6l-6.7-5.6C29.6 35.8 26.9 37 24 37c-5.3 0-9.7-3.3-11.3-8l-7 5.4C9.1 41.1 16 45.5 24 45.5z"></path><path fill="#1976D2" d="M43.6 20H24v8.5h11.3c-.8 2.2-2.2 4.1-4 5.5l6.7 5.6c-.5.4 7-5.1 7-15.6 0-1.4-.2-2.7-.4-4z"></path></svg>`;

const X_GLYPH_PATH =
	"M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.3l7.3-8.3L2.5 2h6.4l4.4 5.9L18.9 2zm-1.1 18h1.7L7.9 3.7H6L17.8 20z";
const LINKEDIN_GLYPH_PATH =
	"M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.5 8h4V24h-4V8zm7.5 0h3.8v2.2h.05c.53-1 1.83-2.2 3.77-2.2 4 0 4.78 2.6 4.78 6V24h-4v-8.5c0-2-.03-4.6-2.8-4.6-2.8 0-3.2 2.2-3.2 4.5V24H8V8z";
const EMAIL_GLYPH_PATH =
	"M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z";
const TELEGRAM_GLYPH_PATH =
	"M9.04 15.5 8.9 19.4c.56 0 .8-.24 1.1-.53l2.63-2.5 5.45 4c1 .55 1.72.26 1.97-.92l3.57-16.8c.32-1.48-.54-2.06-1.5-1.7L1.4 9.1c-1.43.56-1.4 1.36-.25 1.72l5.37 1.68L18.9 4.63c.59-.38 1.13-.17.69.21L9.04 15.5z";
const GITHUB_GLYPH_PATH =
	"M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.4.6.1.82-.26.82-.58v-2.03c-3.34.73-4.04-1.6-4.04-1.6-.55-1.4-1.34-1.76-1.34-1.76-1.1-.75.08-.74.08-.74 1.2.09 1.84 1.25 1.84 1.25 1.08 1.84 2.83 1.3 3.52 1 .1-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.66 1.66.25 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.82.58C20.56 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z";

const WALLET_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1E140D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="14" rx="3"></rect><path d="M16 13h4"></path><path d="M2 10h20"></path></svg>`;

const AUTH_BY_PROVIDER: Record<string, { icon: string; label: string }> = {
	google: { icon: GOOGLE_ICON_SVG, label: "Google via dOAuth" },
	twitter: {
		icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="#1E140D"><path d="${X_GLYPH_PATH}"></path></svg>`,
		label: "X via dOAuth",
	},
	linkedin: {
		icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="#0A66C2"><path d="${LINKEDIN_GLYPH_PATH}"></path></svg>`,
		label: "Linkedin via dOAuth",
	},
	github: {
		icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="#1E140D"><path d="${GITHUB_GLYPH_PATH}"></path></svg>`,
		label: "GitHub via dOAuth",
	},
	algorand: { icon: WALLET_ICON_SVG, label: "Algorand Agency via dOAuth" },
};

/** Well-known ASAs rendered with their own currency code and logo. */
const KNOWN_ASSETS: Record<number, { code: string; decimals: number; logo: string }> = {
	31566704: { code: "USDC", decimals: 6, logo: USDC_LOGO_SVG },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function shorten(value: string): string {
	return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
}

function formatAmount(value: number): string {
	return value.toFixed(6).replace(/\.?0+$/, "");
}

function shareButton(sharer: string, glyphPath: string, title: string, url: string): string {
	return `<button class="shareBtn" data-sharer="${sharer}" data-title="${title}" data-hashtags="algorand,agency,goplausible,agentic_commerce" data-url="${url}" aria-label="Share via ${sharer}"><svg width="13" height="13" viewBox="0 0 24 24" fill="#FFFFFF"><path d="${glyphPath}"></path></svg></button>`;
}

function detailRow(label: string, valueHtml: string): string {
	return `<div class="row"><span class="label">${label}</span>${valueHtml}</div>`;
}

export function buildHTMLPage({
	provider,
	url,
	uuid,
	qrPng,
	qrDataUri,
	from,
	sender,
	txId,
	receiver,
	amount,
	asset,
	note,
	category,
}: {
	provider: string;
	url: string;
	uuid: string;
	qrPng: string;
	qrDataUri: string;
	from: string;
	sender: string;
	txId: string;
	receiver: string;
	amount?: number;
	asset?: number;
	note?: string;
	category: ReceiptCategory;
}): string {
	const uriType = asset !== undefined ? "Asset Transfer Receipt" : "Payment Receipt";
	const knownAsset = asset !== undefined ? KNOWN_ASSETS[asset] : undefined;
	const currency =
		asset === undefined
			? { code: "ALGO", logo: ALGO_LOGO_SVG, pretty: formatAmount((amount ?? 0) / 1e6) }
			: knownAsset
				? {
						code: knownAsset.code,
						logo: knownAsset.logo,
						pretty: formatAmount((amount ?? 0) / 10 ** knownAsset.decimals),
					}
				: { code: "ASA", logo: ASA_LOGO_SVG, pretty: String(amount ?? 0) };

	const now = new Date();
	const timestamp = `${MONTHS[now.getUTCMonth()]} ${now.getUTCDate()}, ${now.getUTCFullYear()} · ${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")} UTC`;

	const ownerDisplay = escapeHtml(provider === "algorand" ? shorten(from) : from);
	const auth = AUTH_BY_PROVIDER[provider] ?? AUTH_BY_PROVIDER.algorand;
	const safeNote = note && note.length > 0 ? escapeHtml(note) : "";

	const label = "GoPlausible Universal Receipt";
	const title = `${label} | ${category} ${uriType} | ${currency.pretty} ${currency.code} | Agent Owner: ${ownerDisplay}`;
	const description = `${category} ${uriType} for ${safeNote ? `${safeNote} | ` : ""}${currency.pretty} ${currency.code} from ${shorten(sender)} to ${shorten(receiver)} on Algorand MainNet.`;

	const badges = RECEIPT_CATEGORIES.map((c) => {
		const state =
			c === category ? " active" : category === "UCP" && c === "AP2" ? " secondary" : "";
		return `<span class="badge${state}">${c}</span>`;
	}).join("\n      ");

	const partyLabels: [string, string] =
		category === "MPP" ? ["PAYER AGENT", "PROVIDER"] : ["FROM", "TO"];

	const rows: string[] = [
		detailRow(partyLabels[0], `<span class="mono" title="${sender}">${shorten(sender)}</span>`),
		detailRow(
			partyLabels[1],
			`<span class="mono" title="${receiver}">${shorten(receiver)}</span>`,
		),
	];
	if (asset !== undefined) {
		rows.push(
			detailRow(
				"ASSET",
				`<span class="mono">${knownAsset ? `${knownAsset.code} · ` : ""}ASA ${asset}</span>`,
			),
		);
	}
	rows.push(
		detailRow(
			"TRANSACTION",
			`<a class="mono txlink" href="https://allo.info/tx/${txId}" target="_blank" rel="noopener noreferrer">${shorten(txId)} <span class="ext">Allo.info ↗</span></a>`,
		),
	);
	if (category === "AP2" || category === "UCP") {
		rows.push(
			detailRow(
				"AGENT MANDATE",
				`<span class="text">${category === "UCP" ? "UCP order · AP2 mandate" : "AP2 payment mandate"}</span>`,
			),
		);
	}
	rows.push(
		detailRow("AGENT OWNER", `<span class="text">${ownerDisplay}</span>`),
		detailRow("AUTHENTICATION", `<span class="auth">${auth.icon}${auth.label}</span>`),
		detailRow(
			"NOTE",
			`<span class="text">${safeNote || `${currency.pretty} ${currency.code} ${asset !== undefined ? "asset transfer" : "payment"}`}</span>`,
		),
	);

	const facilitatorBlock =
		category === "x402"
			? `
    <div class="facilitator">
      <img src="${LOGO_MARK_URL}" alt="GoPlausible" />
      <div class="stack">
        <span class="k">x402 FACILITATOR</span>
        <span class="n">GoPlausible Facilitator</span>
        <a href="https://facilitator.goplausible.xyz" target="_blank" rel="noopener noreferrer" class="mono">facilitator.goplausible.xyz ↗</a>
      </div>
      <span class="check">${CHECK_CIRCLE_SVG}</span>
    </div>`
			: "";

	return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta name="robots" content="index, follow">
  <meta name="author" property="og:author" content="did:algo:UTI7PAASILRDA3ISHY5M7J7LNRX2AIVQJWI7ZKCCGKVLMFD3VPR5PWSZ4I">
  <meta itemprop="name" content="${title}">
  <meta itemprop="description" content="${description}">
  <meta itemprop="image" content="${qrPng}">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1.0, user-scalable=no" />
  <meta name="description" content="${description}" />
  <!-- Twitter Card data -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@goplausible_ai">
  <meta name="twitter:creator" content="@GoPlausible">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${qrPng}">
  <!-- Open Graph data -->
  <meta property="og:image" content="${qrPng}" />
  <meta property="og:domain" content="goplausible.xyz" />
  <meta property="og:url" content="https://goplausible.xyz/api/receipt/${uuid}" />
  <meta property="og:title" content="${title}"/>
  <meta property="og:type" content="website" />
  <meta property="og:description" content="${description}" />
  <link rel="icon" href="${FAVICON_URL}" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px 16px;
      background: #F1EDE9;
      font-family: 'Instrument Sans', sans-serif;
      color: #1E140D;
      display: flex;
      justify-content: center;
    }
    a { color: #C15F2B; text-decoration: none; }
    a:hover { color: #9E4A1E; text-decoration: underline; }
    .mono { font-family: 'JetBrains Mono', monospace; }
    .card {
      width: 480px;
      max-width: 100%;
      background: #FFFFFF;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 24px 60px rgba(30,20,13,0.14), 0 2px 6px rgba(30,20,13,0.08);
    }
    .header { background: #1E140D; padding: 20px 28px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .header img { height: 48px; display: block; }
    .header .pill { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; letter-spacing: 1.6px; color: #E89B6B; border: 1px solid rgba(232,155,107,0.45); border-radius: 99px; padding: 5px 12px; white-space: nowrap; }
    .badges { display: flex; gap: 6px; padding: 16px 28px 0 28px; flex-wrap: wrap; }
    .badge { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; padding: 5px 11px; border-radius: 99px; color: #6B5E52; border: 1px solid #E5DCD3; background: #F8F5F2; }
    .badge.active { color: #1E140D; background: #E89B6B; border-color: #E89B6B; }
    .badge.secondary { color: #1E140D; background: #F6DEC9; border-color: #EBC7A8; }
    .hero { padding: 26px 28px 22px 28px; text-align: center; border-bottom: 1px dashed #E5DCD3; }
    .settled { display: inline-flex; align-items: center; gap: 8px; color: #2E7D32; font-weight: 600; font-size: 13px; margin-bottom: 14px; }
    .amount { display: flex; align-items: center; justify-content: center; gap: 12px; }
    .amount .value { font-family: 'Sora', sans-serif; font-weight: 800; font-size: 44px; color: #1E140D; letter-spacing: -1.5px; }
    .amount .code { font-family: 'Sora', sans-serif; font-weight: 600; font-size: 20px; color: #6B5E52; align-self: flex-end; padding-bottom: 8px; }
    .chip { display: inline-flex; align-items: center; gap: 7px; margin-top: 12px; background: #F8F5F2; border: 1px solid #E5DCD3; border-radius: 99px; padding: 6px 14px; }
    .chip .net { font-size: 12.5px; font-weight: 600; color: #1E140D; }
    .chip .sep { color: #C2B6AA; }
    .chip .ts { font-size: 12.5px; color: #6B5E52; }
    .details { padding: 22px 28px; display: grid; gap: 13px; border-bottom: 1px dashed #E5DCD3; }
    .row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .row .label { font-size: 12px; font-weight: 600; letter-spacing: 0.8px; color: #96897C; }
    .row .mono { font-size: 13px; font-weight: 500; color: #1E140D; }
    .row .text { font-size: 13px; font-weight: 500; color: #1E140D; text-align: right; }
    .row a.txlink { font-weight: 600; color: #C15F2B; display: inline-flex; align-items: center; gap: 6px; }
    .row .ext { font-size: 11px; font-weight: 500; color: #96897C; font-family: 'Instrument Sans', sans-serif; }
    .row .auth { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 500; color: #1E140D; }
    .facilitator { margin: 18px 28px 0 28px; background: #FBF1E8; border: 1px solid #EBC7A8; border-radius: 14px; padding: 14px 16px; display: flex; align-items: center; gap: 12px; }
    .facilitator img { width: 32px; height: 32px; display: block; }
    .facilitator .stack { display: grid; gap: 2px; }
    .facilitator .k { font-size: 11px; font-weight: 600; letter-spacing: 0.8px; color: #6B5E52; }
    .facilitator .n { font-size: 13.5px; font-weight: 600; color: #1E140D; }
    .facilitator .stack a { font-size: 12px; }
    .facilitator .check { margin-left: auto; flex-shrink: 0; display: inline-flex; }
    .qrshare { padding: 22px 28px; display: flex; gap: 18px; align-items: center; }
    .qrbox { background: #FFFFFF; border: 1px solid #E5DCD3; border-radius: 12px; padding: 8px; flex-shrink: 0; }
    .qrbox img { width: 104px; height: 104px; display: block; image-rendering: pixelated; }
    .sharecol { display: grid; gap: 6px; min-width: 0; }
    .sharecol .k { font-size: 11px; font-weight: 600; letter-spacing: 0.8px; color: #96897C; }
    .sharecol .rurl { font-size: 11.5px; word-break: break-all; line-height: 1.5; }
    .shareBtns { display: flex; gap: 8px; margin-top: 4px; }
    .shareBtn { width: 30px; height: 30px; border-radius: 99px; background: #1E140D; border: none; padding: 0; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
    .shareBtn:hover { background: #3A2A1D; }
    .brand { padding: 0 28px 20px 28px; }
    .brand img { width: 100%; border-radius: 12px; display: block; }
    .footer { background: #F8F5F2; border-top: 1px solid #EAE2DA; padding: 14px 28px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
    .footer a { font-size: 11.5px; }
    .footer .copy { color: #96897C; }
    .footer .links { display: flex; gap: 14px; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/sharer.js@0.5.2/sharer.min.js"></script>
</head>
<body>
  <main class="card">
    <div class="header">
      <img src="${LOGOTYPE_URL}" alt="GoPlausible" />
      <span class="pill">UNIVERSAL RECEIPT</span>
    </div>
    <div class="badges">
      ${badges}
    </div>
    <div class="hero">
      <div class="settled">${CHECK_CIRCLE_SVG} Payment settled</div>
      <div class="amount">
        ${currency.logo}
        <span class="value">${currency.pretty}</span>
        <span class="code">${currency.code}</span>
      </div>
      <div class="chip">${ALGO_CHIP_MARK_SVG}<span class="net">Algorand MainNet</span><span class="sep">·</span><span class="ts">${timestamp}</span></div>
    </div>
    <div class="details">
      ${rows.join("\n      ")}
    </div>${facilitatorBlock}
    <div class="qrshare">
      <div class="qrbox">
        <img src="${qrDataUri}" alt="Receipt QR" />
      </div>
      <div class="sharecol">
        <span class="k">SCAN OR SHARE THIS RECEIPT</span>
        <a class="mono rurl" href="${url}">${url.replace("https://", "")}</a>
        <div class="shareBtns">
          ${shareButton("x", X_GLYPH_PATH, title, url)}
          ${shareButton("linkedin", LINKEDIN_GLYPH_PATH, title, url)}
          ${shareButton("email", EMAIL_GLYPH_PATH, title, url)}
          ${shareButton("telegram", TELEGRAM_GLYPH_PATH, title, url)}
        </div>
      </div>
    </div>
    <div class="brand">
      <a href="https://goplausible.com" target="_blank" rel="noopener noreferrer"><img src="${OG_IMAGE_URL}" alt="GoPlausible — AI &amp; Agentic tooling for Algorand" /></a>
    </div>
    <div class="footer">
      <a class="copy" href="https://goplausible.com" target="_blank" rel="noopener noreferrer">&copy; GoPlausible ${now.getUTCFullYear()}</a>
      <div class="links">
        <a href="https://doauth.org" target="_blank" rel="noopener noreferrer">dOAuth.org</a>
        <a href="https://facilitator.goplausible.xyz" target="_blank" rel="noopener noreferrer">Facilitator</a>
        <a href="https://goplausible.com/terms" target="_blank" rel="noopener noreferrer">Terms</a>
        <a href="https://goplausible.com/privacy" target="_blank" rel="noopener noreferrer">Privacy</a>
      </div>
    </div>
  </main>
</body>
</html>
  `.trim();
}

async function generateAlgorandReceipt(
	params: any,
): Promise<{ url: string; qrCode: string; qrDataUri: string }> {
	// Validate address format (base32 string)
	if (!params.sender || !/^[A-Z2-7]{58}$/.test(params.sender)) {
		throw new Error("Invalid Algorand sender address format");
	}
	if (!params.receiver || !/^[A-Z2-7]{58}$/.test(params.receiver)) {
		throw new Error("Invalid Algorand receiver address format");
	}
	//TODO: check other params validity

	// Start building the url with the scheme and address
	const url = `https://goplausible.xyz/api/receipt/${params.uuid}`;

	console.log("Generated URL:", url);
	const pngBuffer = await generate(url, "png", {
		ecLevel: "H",
		scale: 8,
		margin: 2,
	});
	console.log("Generated PNG Buffer length:", pngBuffer.length);
	const blank = PhotonImage.new_from_base64(getBgPng().split(",")[1]);
	console.log("Created blank image");
	const qrImg = PhotonImage.new_from_byteslice(new Uint8Array(pngBuffer));
	console.log("Created QR image from PNG buffer");
	const x = Math.floor((blank.get_width() - qrImg.get_width()) / 2);
	const y = Math.floor((blank.get_height() - qrImg.get_height()) / 2);
	console.log(`Calculated position to center QR: (${x}, ${y})`);
	try {
		await watermark(blank, qrImg, BigInt(x), BigInt(y));
	} catch (error) {
		console.error("Error during watermarking:", error);
	}
	console.log("Merged QR onto blank image");

	const jpegBytes = blank.get_bytes_jpeg(100); // quality: 0–100
	console.log("Converted merged image to JPEG bytes");

	return {
		url,
		qrCode: Buffer.from(new Uint8Array(jpegBytes)).toString("base64"),
		qrDataUri: `data:image/png;base64,${Buffer.from(new Uint8Array(pngBuffer)).toString("base64")}`,
	};
}
/**
 * Register Receipt tools to the MCP server
 */
export function registerReceiptTools(server: McpServer, env: Env, props: Props): void {
	console.log("Registering Receipt tools for Algorand Remote MCP");

	server.tool(
		"generate_algorand_receipt",
		"Generate a Universal Receipt and QRCode of it, for an Algorand payment or asset transfer (TXN, x402, MPP, AP2 or UCP)",
		{
			sender: z.string().describe("Algorand address (58 characters)"),
			receiver: z.string().describe("Algorand address (58 characters)"),
			amount: z
				.number()
				.optional()
				.describe("Amount in microAlgos (for payment) or asset units (for asset transfer)"),
			assetId: z.number().optional().describe("Asset ID (for asset transfer)"),
			txId: z.string().describe("Transaction hash"),
			note: z.string().optional().describe("Optional note"),
			category: z
				.enum(RECEIPT_CATEGORIES)
				.default("TXN")
				.describe(
					"Optional receipt category: TXN (plain transaction, default), x402, MPP, AP2 or UCP. Selecting UCP also marks AP2 on the receipt (UCP implies AP2)",
				),
		},
		async ({ sender, receiver, amount, assetId, note, txId, category }) => {
			try {
				const uuid = crypto.randomUUID().replaceAll("-", "");
				const toolArgs: any = {
					sender,
					receiver,
					amount,
					asset: assetId,
					txId,
					note,
					category,
					uuid,
				};
				console.log("Generating Receipt with args:", toolArgs);

				const { url, qrCode, qrDataUri } = await generateAlgorandReceipt(toolArgs);
				console.log("Generated Receipt URL:", url);
				await env.ARC26_KV?.put(`image--${uuid}`, qrCode, { expirationTtl: 86400 * 7 }); // Cache for 7 days

				const htmlPage = buildHTMLPage({
					provider: props.provider,
					url,
					uuid,
					qrPng: `https://goplausible.xyz/api/receipt/image/${uuid}.jpeg`,
					qrDataUri,
					from: props.email,
					sender,
					txId,
					receiver,
					amount,
					asset: assetId,
					note,
					category,
				});
				await env.ARC26_KV?.put(`rid--${uuid}`, htmlPage, { expirationTtl: 86400 * 7 }); // Cache for 7 days

				return ResponseProcessor.processResponse({
					label: "Algorand Agency Universal Receipt link (valid for 7 days)",
					category,
					qrcode_link: `https://goplausible.xyz/api/receipt/${uuid}`,
				});
			} catch (error: any) {
				return {
					content: [
						{
							type: "text",
							text: `Error generating Algorand Receipt: ${error.message || "Unknown error"}`,
						},
					],
				};
			}
		},
	);
}
