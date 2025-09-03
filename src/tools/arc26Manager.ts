/**
 * ARC-26 Manager for Algorand Remote MCP
 * Handles Algorand URI generation following ARC-26 specification
 * https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0026.md
 */
import { PhotonImage, resize, watermark, SamplingFilter } from "@cf-wasm/photon";
import { z } from 'zod';
import { ResponseProcessor } from '../utils';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Env, Props } from '../types';
import { generate } from '@juit/qrcode'

function buildHTMLPage({
  provider,
  uri,
  uriType,
  uuid,
  qrPng,
  from,
  label,
  label2,
  amount
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
}): string {

  const prettyLabel = label || "Algorand QRCode";
  const prettyAmount = amount && uriType !== 'Asset Transfer Request' ? `${amount / 1e6} Algo` : amount && uriType === 'Asset Transfer Request' ? amount : "No payment or transfer amount included!";
  const title = `${prettyLabel} from ${from}`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta charset="utf-8" />
  <meta name="robots" content="index, follow">
  <meta name="author" property="og:author" content="did:algo:UTI7PAAS...R5PWSZ4I">
  <meta itemprop="name" content="Algorand Agent on X ${label2} from ${from}">
  <meta itemprop="description" content="${label2} for ${prettyAmount} to this Algorand address via ARC-26 URI.">
  <meta itemprop="image" content="${qrPng}" type="image/jpeg">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1.0, user-scalable=no" />
  <meta name="description" content="${label2}" />
  <!-- Twitter Card data -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@goplausible_ai">
  <meta name="twitter:creator" content="@GoPlausible">
  <meta name="twitter:title" content="Algorand Agent on X ${label2} from ${from}">
  <meta name="twitter:description" content="${label2} for ${prettyAmount} to this Algorand address via ARC-26 URI.">
  <meta name="twitter:image" content="${qrPng}" type="image/jpeg">
  <!-- Open Graph data -->
  <meta property="og:image" content="${qrPng}" type="image/jpeg""/>
  <meta property="og:domain" content="goplausible.xyz" />
  <meta property="og:url" content="https://goplausible.xyz/api/arc26/${uuid}" />
  <meta property="og:title" content="Algorand Agent on X ${label2} from ${from}"/>
  <meta property="og:type" content="website" />
  <meta property="og:description" content="${label2} for ${prettyAmount} to this Algorand address via ARC-26 URI." />

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
    
    <img src="https://agency.goplausible.xyz/images/Agent.png" alt="Algorand X Agent" style="width:64px; height:64px; border-radius:50%; object-fit:cover; margin-bottom:1rem;" />

    <h2><strong>👋 Hey ${provider === 'twitter'? '@':''}${from}</strong></h2>
    
    <h3>Your ${label2}</h3>
    
    <div class="qr">
      ${qrPng ? `<img src="${qrPng}" alt="${prettyLabel}" style="
        width: 100%;
        box-shadow: 0 4px 14px #607D8B;
        border-radius: 25px;"
        />` : '<p>No QR code available</p>'}
    </div>
    
    <div class="uri">${uri}</div>
    <h2>${prettyLabel}</h2>
    <img style="width:120px; height:40px;" src="https://storage.goplausible.xyz/ipfs/QmWjvCGPyL9zmA5B84WPqLYF27dL2nFgr1Lw6rMd7CpQPV/images/goPlausible-logo-type-h.png" alt="GoPlausible" />
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
function generateAlgorandUri(
  address: string,
  label?: string,
  amount?: number,
  assetId?: number,
  note?: string
): string {
  // Validate address format (58 characters)
  if (!/^[A-Z2-7]{58}$/.test(address)) {
    throw new Error('Invalid Algorand address format');
  }

  // Build the base URI
  let uri = `algorand://${address}`;

  // Build query parameters
  const queryParams: string[] = [];

  // Add optional label
  if (label) {
    queryParams.push(`label=${encodeURIComponent(label)}`);
  }

  // Add optional amount
  if (amount !== undefined) {
    queryParams.push(`amount=${amount}`);
  }

  // Add optional assetId
  if (assetId !== undefined) {
    queryParams.push(`asset=${assetId}`);
  }

  // Add optional note
  if (note) {
    queryParams.push(`note=${encodeURIComponent(note)}`);
  }

  // Append query string if we have parameters
  if (queryParams.length > 0) {
    uri += '?' + queryParams.join('&');
  }

  return uri;
}
async function generateAlgorandQr(params: any): Promise<{ uri: string; qrCode: string }> {
  // Validate address format (base32 string)
  if (!params.address || !/^[A-Z2-7]{58}$/.test(params.address)) {
    throw new Error('Invalid Algorand address format');
  }

  // Start building the URI with the scheme and address
  let uri = `algorand://${params.address}`;

  // Build query parameters
  const queryParams: string[] = [];

  // Add optional parameters if provided
  if (params.label) {
    queryParams.push(`label=${params.label}`);
  }

  if (typeof params.amount === 'number') {
    if (params.amount < 0) {
      throw new Error('Amount must be non-negative');
    }
    // Convert to microAlgos and ensure no decimals
    const microAlgos = Math.floor(params.amount);
    queryParams.push(`amount=${microAlgos}`);
  }

  if (typeof params.asset === 'number') {
    if (params.asset < 0) {
      throw new Error('Asset ID must be non-negative');
    }
    queryParams.push(`asset=${params.asset}`);
  }

  if (params.note) {
    queryParams.push(`note=${params.note}`);
  }

  // if (params.xnote) {
  //   queryParams.push(`xnote=${encodeURIComponent(params.xnote)}`);
  // }

  // Add query parameters to URI if any exist
  if (queryParams.length > 0) {
    uri += '?' + queryParams.join('&');
  }


  console.log('Generated URI:', uri);
  const pngBuffer = await generate(uri, 'png', {
    ecLevel: 'H',
    scale: 5,
    margin: 3,
  });
  console.log('Generated PNG Buffer length:', pngBuffer.length);





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
  console.log('Converted merged image to JPEG bytes');

  return {
    uri,
    qrCode: Buffer.from(new Uint8Array(jpegBytes)).toString('base64')
  };
}

/**
 * Register ARC-26 tools to the MCP server
 */
export function registerArc26Tools(server: McpServer, env: Env, props: Props): void {
  // Generate Algorand URI
  server.tool(
    'generate_algorand_uri',
    'Generate a URI following the Algorand ARC-26 specification to send account address or request payment or asset transfer',
    {
      address: z.string().describe('Algorand address (58 characters)'),
      label: z.string().optional().describe('Optional label for the address'),
      amount: z.number().optional().describe('Amount in microAlgos (for payment) or asset units (for asset transfer)'),
      assetId: z.number().optional().describe('Asset ID (for asset transfer)'),
      note: z.string().optional().describe('Optional note')
    },
    async ({ address, label, amount, assetId, note }) => {
      try {
        const uri = generateAlgorandUri(address, label, amount, assetId, note);
        
        // Determine URI type
        let uriType = 'Account URI';
        if (amount !== undefined && assetId !== undefined) {
          uriType = 'Asset Transfer URI';
        } else if (amount !== undefined) {
          uriType = 'Payment URI';
        }
        
        return ResponseProcessor.processResponse({ 
          uri,
          uriType,
        });
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Error generating Algorand URI: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );
   server.tool(
    'generate_algorand_qrcode',
    'Generate a URI and QRCode of it,  following the Algorand ARC-26 specification to send account address or request payment or asset transfer',
    {
      address: z.string().describe('Algorand address (58 characters)'),
      // label: z.string().optional().describe('Optional label for the address'),
      amount: z.number().optional().describe('Amount in microAlgos (for payment) or asset units (for asset transfer)'),
      assetId: z.number().optional().describe('Asset ID (for asset transfer)'),
      note: z.string().optional().describe('Optional note')
    },
    async ({ address/* , label */, amount, assetId, note }) => {
      try {
        const toolArgs: any = {
          address,
          // label,
          amount,
          asset: assetId,
          note
        };
        // const uri = generateAlgorandUri(address, label, amount, assetId, note);
        console.log('Generating ARC-26 QR with args:', toolArgs);
        const { uri, qrCode } = await generateAlgorandQr(toolArgs);
        console.log('Generated ARC-26 URI:', uri);
        console.log('Generated ARC-26 QR Code (base64 PNG):', qrCode);
        // Determine URI type
        let uriType = 'Account Contact';
        if (amount !== undefined && amount !== 0 && assetId !== undefined) {
          uriType = 'Asset Transfer Request';
        } else if (amount !== undefined) {
          uriType = 'Payment Request';
        }


        const uuid = crypto.randomUUID().replaceAll('-', '');

        await env.ARC26_KV?.put(`image--${uuid}`, qrCode, { expirationTtl: 86400 * 7 }); // Cache for 7 days

        const htmlPage = buildHTMLPage({
          provider: props.provider,
          uri,
          uriType,
          uuid,
          qrPng: `https://goplausible.xyz/api/arc26/image/${uuid}.jpeg`,
          from: props.email,
          label: `Algorand X Agent`,
          label2: `${uriType}`,
          amount
        })
        await env.ARC26_KV?.put(`id--${uuid}`, htmlPage, { expirationTtl: 86400 * 7 }); // Cache for 7 days

        return ResponseProcessor.processResponse({
          label: `Algorand ARC-26 QR Code link (valid for 7 days)`,
          qrcode_link: `https://goplausible.xyz/api/arc26/${uuid}`,
        });


      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Error generating Algorand URI: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );
}
