/**
 * ARC-90 Manager for Algorand Remote MCP
 * Generates Algorand payment URIs, and QR codes of them, following the ARC-90 URI scheme, which
 * supersedes ARC-26: https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0090.md
 *
 * This server runs on MainNet, the canonical network, so the URIs it emits carry no network
 * authority: ARC-90 requires emitters that target the canonical network to omit it.
 */
import { PhotonImage, SamplingFilter, resize, watermark } from "@cf-wasm/photon";
import { generate } from "@juit/qrcode";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env, Props } from "../types";
import { ResponseProcessor } from "../utils";

// QR pages and images are served by goplausible.xyz from the ARC90_KV namespace; changing this
// path needs the matching route on goplausible.xyz.
const QR_PAGE_BASE_URL = "https://goplausible.xyz/api/arc90";

const ALGORAND_ADDRESS = /^[A-Z2-7]{58}$/;

function buildHTMLPage({
	provider,
	uri,
	uriType,
	uuid,
	qrPng,
	from,
	label,
	label2,
	amount,
}: {
	provider: string;
	uri: string;
	uriType: string;
	uuid: string;
	qrPng: string;
	from: string;
	label?: string;
	label2?: string;
	amount?: number;
	decimals?: number;
}): string {
	const prettyLabel = label || "Algorand QRCode";
	const prettyAmount =
		amount && uriType !== "Asset Transfer Request"
			? `${amount / 1e6} Algo`
			: amount && uriType === "Asset Transfer Request"
				? amount
				: "No payment or transfer amount included!";
	const title = `${prettyLabel} from ${from}`;
	// The URI is percent-encoded, so & is the only character in it HTML reads specially; written
	// as it is, the '&not' of '&note=' would display as '¬e='.
	const uriText = uri.replaceAll("&", "&amp;");

	return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta charset="utf-8" />
  <meta name="robots" content="index, follow">
  <meta name="author" property="og:author" content="did:algo:UTI7PAAS...R5PWSZ4I">
  <meta itemprop="name" content="Algorand Agent ${label2} from ${from}">
  <meta itemprop="description" content="${label2} for ${prettyAmount} to this Algorand address via ARC-90 URI.">
  <meta itemprop="image" content="${qrPng}" type="image/jpeg">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1.0, user-scalable=no" />
  <meta name="description" content="${label2}" />
  <!-- Twitter Card data -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@goplausible_ai">
  <meta name="twitter:creator" content="@GoPlausible">
  <meta name="twitter:title" content="Algorand Agent  ${label2} from ${from}">
  <meta name="twitter:description" content="${label2} for ${prettyAmount} to this Algorand address via ARC-90 URI.">
  <meta name="twitter:image" content="${qrPng}" type="image/jpeg">
  <!-- Open Graph data -->
  <meta property="og:image" content="${qrPng}" type="image/jpeg""/>
  <meta property="og:domain" content="goplausible.xyz" />
  <meta property="og:url" content="${QR_PAGE_BASE_URL}/${uuid}" />
  <meta property="og:title" content="Algorand Agent ${label2} from ${from}"/>
  <meta property="og:type" content="website" />
  <meta property="og:description" content="${label2} for ${prettyAmount} to this Algorand address via ARC-90 URI." />

  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, sans-serif;
      background: #f9f9f9;
      padding: 2rem;
      text-align: center;
      color: #2d3748;
    }
    .card {
      background: white;
      padding: 2rem;
      border-radius: 12px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.1);
      max-width: 500px;
      margin: 0 auto;
    }
    h1 {
      font-size: 1.5rem;
      margin-bottom: 0.5rem;
    }
    h2 {
      font-size: 1rem;
      margin-bottom: 0.5rem;
    }
    h3 {
      color: #2196F3;
      margin-bottom: 0.5rem;
    }
    .from {
      font-size: 0.9rem;
 
      margin-bottom: 1.5rem;
    }
    .qr {
      margin-bottom: 1.5rem;
    }
    .uri {
      font-size: 0.85rem;
      font-family: monospace;
      word-break: break-all;
      background: #f1f5f9;
      padding: 0.75rem;
      border-radius: 6px;
    }
  </style>
</head>
<body>
  <div class="card">
    
    <img src="https://agency.goplausible.xyz/images/Agent.png" alt="${provider === "twitter" ? "X" : provider === "google" ? "Google" : provider === "linkedin" ? "Linkedin" : provider === "github" ? "GitHub" : provider === "algorand" ? "Agency" : ""}" style="width:64px; height:64px; border-radius:50%; object-fit:cover; margin-bottom:1rem;" />

    <h2><strong>👋 Hey ${provider === "twitter" ? "@" : ""}${provider === "algorand" ? `${from.slice(0, 6)}...${from.slice(-6)}` : from}</strong></h2>
    
    <h3>Your ${label2}</h3>
    
    <div class="qr">
      ${
			qrPng
				? `<img src="${qrPng}" alt="${prettyLabel}" style="
        width: 100%;
        box-shadow: 0 4px 14px #607D8B;
        border-radius: 25px;"
        />`
				: "<p>No QR code available</p>"
		}
    </div>
    
    <div class="uri">${uriText}</div>
    <h2>${prettyLabel}</h2>
    <img style="width:120px; height:40px;" src="https://goplausible.mypinata.cloud/ipfs/QmWjvCGPyL9zmA5B84WPqLYF27dL2nFgr1Lw6rMd7CpQPV/images/goPlausible-logo-type-h.png" alt="GoPlausible" />
    <div style="margin-top: 1rem; font-size: 0.5rem; color: #718096;">
      <a href="https://goplausible.com/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a> &nbsp;|&nbsp;
      <a href="https://goplausible.com/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
      <br />
      &copy; GoPlausible 2025
    </div>
  </div>
</body>
</html>
  `.trim();
}
/**
 * Percent-encode a text value for an ARC-90 query parameter. ARC-90 requires every character
 * outside the RFC 3986 unreserved set (ALPHA / DIGIT / "-" / "." / "_" / "~") to be UTF-8 encoded
 * and then percent-encoded. encodeURIComponent leaves ! ' ( ) * unencoded, so those are encoded
 * here.
 */
export function encodeArc90QueryValue(value: string): string {
	return encodeURIComponent(value).replace(
		/[!'()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

/**
 * Build an ARC-90 payment URI: algorand://<address>[?label=&amount=&asset=&note=&xnote=].
 * amount is in base units (microAlgos, or the asset's smallest unit) and ARC-90 allows only
 * non-negative integers. An assetId of 0 means Algo, for which ARC-90 says to omit the asset
 * parameter. note is a default the wallet may let the user edit; xnote must not be editable.
 */
export function generateAlgorandUri(
	address: string,
	label?: string,
	amount?: number,
	assetId?: number,
	note?: string,
	xnote?: string,
): string {
	if (!ALGORAND_ADDRESS.test(address)) {
		throw new Error("Invalid Algorand address format");
	}

	const queryParams: string[] = [];

	if (label) {
		queryParams.push(`label=${encodeArc90QueryValue(label)}`);
	}

	if (amount !== undefined) {
		if (!Number.isSafeInteger(amount) || amount < 0) {
			throw new Error(
				"Amount must be a non-negative integer in base units (microAlgos, or the asset's smallest unit)",
			);
		}
		queryParams.push(`amount=${amount}`);
	}

	if (assetId !== undefined) {
		if (!Number.isSafeInteger(assetId) || assetId < 0) {
			throw new Error("Asset ID must be a non-negative integer");
		}
		if (assetId !== 0) {
			queryParams.push(`asset=${assetId}`);
		}
	}

	if (note) {
		queryParams.push(`note=${encodeArc90QueryValue(note)}`);
	}

	if (xnote) {
		queryParams.push(`xnote=${encodeArc90QueryValue(xnote)}`);
	}

	const uri = `algorand://${address}`;
	return queryParams.length > 0 ? `${uri}?${queryParams.join("&")}` : uri;
}
// URI type reported by the generate_algorand_uri tool (an assetId of 0 means Algo)
export function determineUriType(amount?: number, assetId?: number): string {
	let uriType = "Account URI";
	if (amount !== undefined && assetId !== undefined && assetId !== 0) {
		uriType = "Asset Transfer URI";
	} else if (amount !== undefined) {
		uriType = "Payment URI";
	}
	return uriType;
}
// URI type reported by the generate_algorand_qrcode tool (an assetId of 0 means Algo)
export function determineQrUriType(amount?: number, assetId?: number): string {
	let uriType = "Account Contact";
	if (amount !== undefined && amount !== 0 && assetId !== undefined && assetId !== 0) {
		uriType = "Asset Transfer Request";
	} else if (amount !== undefined) {
		uriType = "Payment Request";
	}
	return uriType;
}
async function generateAlgorandQr(params: any): Promise<{ uri: string; qrCode: string }> {
	const uri = generateAlgorandUri(
		params.address,
		params.label,
		params.amount,
		params.asset,
		params.note,
		params.xnote,
	);

	console.log("Generated URI:", uri);
	const pngBuffer = await generate(uri, "png", {
		ecLevel: "H",
		scale: 8,
		margin: 2,
	});
	console.log("Generated PNG Buffer length:", pngBuffer.length);

	// const outputImage = resize(
	//   blank,
	//   1200,
	//   600,
	//   SamplingFilter.Nearest
	// );

	// console.log('Created blank image');

	const qrImg = PhotonImage.new_from_byteslice(new Uint8Array(pngBuffer));
	// console.log('Created QR image from PNG buffer');
	// console.log('Resized QR image');

	// const x = Math.floor((blank.get_width() - qrImg.get_width()) / 2);
	// const y = Math.floor((blank.get_height() - qrImg.get_height()) / 2);
	// console.log(`Calculated position to center QR: (${x}, ${y})`);

	// try {
	//   await watermark(blank, qrImg, BigInt(x), BigInt(y));
	// } catch (error) {
	//   console.error('Error during watermarking:', error);
	// }
	// console.log('Merged QR onto blank image');

	const jpegBytes = qrImg.get_bytes_jpeg(100); // quality: 0–100
	console.log("Converted merged image to JPEG bytes");

	return {
		uri,
		qrCode: Buffer.from(new Uint8Array(jpegBytes)).toString("base64"),
	};
}

/**
 * Register ARC-90 tools to the MCP server
 */
export function registerArc90Tools(server: McpServer, env: Env, props: Props): void {
	// Generate Algorand URI
	server.tool(
		"generate_algorand_uri",
		"Generate an Algorand payment URI following the ARC-90 URI scheme (which supersedes ARC-26) to share an account address or request a payment or asset transfer on MainNet",
		{
			address: z.string().describe("Algorand address (58 characters)"),
			label: z.string().optional().describe("Optional label for the address"),
			amount: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe(
					"Amount as an integer in base units: microAlgos (for payment) or the asset's smallest unit (for asset transfer)",
				),
			assetId: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe("Asset ID (for asset transfer); omit or use 0 for Algo"),
			note: z
				.string()
				.optional()
				.describe("Optional default note, which the wallet may let the user edit"),
			xnote: z
				.string()
				.optional()
				.describe("Optional note the wallet must show but must not let the user edit"),
		},
		async ({ address, label, amount, assetId, note, xnote }) => {
			try {
				const uri = generateAlgorandUri(address, label, amount, assetId, note, xnote);

				// Determine URI type
				const uriType = determineUriType(amount, assetId);

				return ResponseProcessor.processResponse({
					uri,
					uriType,
				});
			} catch (error: any) {
				return {
					content: [
						{
							type: "text",
							text: `Error generating Algorand URI: ${error.message || "Unknown error"}`,
						},
					],
				};
			}
		},
	);
	server.tool(
		"generate_algorand_qrcode",
		"Generate an Algorand payment URI following the ARC-90 URI scheme (which supersedes ARC-26) and a QR code of it, on a page valid for 1 day, to share an account address or request a payment or asset transfer on MainNet",
		{
			address: z.string().describe("Algorand address (58 characters)"),
			// label: z.string().optional().describe('Optional label for the address'),
			amount: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe(
					"Amount as an integer in base units: microAlgos (for payment) or the asset's smallest unit (for asset transfer)",
				),
			decimals: z
				.number()
				.optional()
				.describe("The decimals of the asset (integer number like 6 for USDC or Algo)"),
			assetId: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe("Asset ID (for asset transfer); omit or use 0 for Algo"),
			note: z
				.string()
				.optional()
				.describe("Optional default note, which the wallet may let the user edit"),
			xnote: z
				.string()
				.optional()
				.describe("Optional note the wallet must show but must not let the user edit"),
		},
		async ({ address /* , label */, amount, assetId, note, xnote }) => {
			try {
				const toolArgs: any = {
					address,
					// label,
					amount,
					asset: assetId,
					note,
					xnote,
				};
				console.log("Generating ARC-90 QR with args:", toolArgs);
				const { uri, qrCode } = await generateAlgorandQr(toolArgs);
				console.log("Generated ARC-90 URI:", uri);
				console.log("Generated ARC-90 QR Code (base64 PNG):", qrCode);
				// Determine URI type
				const uriType = determineQrUriType(amount, assetId);

				const uuid = crypto.randomUUID().replaceAll("-", "");

				await env.ARC90_KV?.put(`image--${uuid}`, qrCode, { expirationTtl: 86400 }); // Cache for 1 day

				const htmlPage = buildHTMLPage({
					provider: props.provider,
					uri,
					uriType,
					uuid,
					qrPng: `${QR_PAGE_BASE_URL}/image/${uuid}.jpeg`,
					from: props.email,
					label: `Algorand ${props.provider === "twitter" ? "X" : props.provider === "google" ? "Google" : props.provider === "linkedin" ? "Linkedin" : props.provider === "github" ? "GitHub" : props.provider === "algorand" ? "Agency" : ""} Agent`,
					label2: `${uriType}`,
					amount,
				});
				await env.ARC90_KV?.put(`id--${uuid}`, htmlPage, { expirationTtl: 86400 }); // Cache for 1 day

				return ResponseProcessor.processResponse({
					label: "Algorand ARC-90 QR Code link (valid for 1 day)",
					qrcode_link: `${QR_PAGE_BASE_URL}/${uuid}`,
				});
			} catch (error: any) {
				return {
					content: [
						{
							type: "text",
							text: `Error generating Algorand URI: ${error.message || "Unknown error"}`,
						},
					],
				};
			}
		},
	);
}
