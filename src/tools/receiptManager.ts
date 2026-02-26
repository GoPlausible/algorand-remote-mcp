/**
 * Receipt Manager for Algorand Remote MCP
 */
import { PhotonImage, resize, watermark, SamplingFilter } from "@cf-wasm/photon";
import { z } from 'zod';
import { ResponseProcessor } from '../utils';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Env, Props } from '../types';
import { generate } from '@juit/qrcode'
import { getLogo, getBgPng } from '../logoUrl'

function buildHTMLPage({
  provider,
  url,
  uuid,
  qrPng,
  from,
  sender,
  txId,
  receiver,
  amount,
  asset,
  note
}: {
  provider: string;
  url: string;
  uuid: string;
  qrPng: string;
  from: string;
  sender: string;
  txId: string;
  receiver: string;
  amount?: number;
  asset?: number;
  note?: string;
}): string {
  const label = 'Receipt for Algorand Agent Transaction';
  const uriType = asset !== undefined ? 'Asset Transfer Receipt' : 'Payment Receipt'
  const prettyAmount = amount && uriType !== 'Asset Transfer Receipt' ? `${amount / 1e6} Algo` : `${amount} units of Asset ${asset}`;
  const title = `${label} | ${uriType} | Agent Owner: ${provider === 'algorand' ? from.slice(0, 6) + '...' + from.slice(-6) : from}`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta charset="utf-8" />
  <meta name="robots" content="index, follow">
  <meta name="author" property="og:author" content="did:algo:UTI7PAASILRDA3ISHY5M7J7LNRX2AIVQJWI7ZKCCGKVLMFD3VPR5PWSZ4I">
  <meta itemprop="name" content="${title}">
  <meta itemprop="description" content="${uriType} for ${note && note.length > 0 ? note + ' | ' : ''} ${prettyAmount} from ${typeof sender === 'string' && sender.length > 12 ? `${sender.slice(0, 6)}...${sender.slice(-6)}` : sender} to ${typeof receiver === 'string' && receiver.length > 12 ? `${receiver.slice(0, 6)}...${receiver.slice(-6)}` : receiver}.">
  <meta itemprop="image" content="${qrPng}" type="image/jpeg">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1.0, user-scalable=no" />
  <meta name="description" content="${uriType} for ${note && note.length > 0 ? note + ' | ' : ''} ${prettyAmount} from ${typeof sender === 'string' && sender.length > 12 ? `${sender.slice(0, 6)}...${sender.slice(-6)}` : sender} to ${typeof receiver === 'string' && receiver.length > 12 ? `${receiver.slice(0, 6)}...${receiver.slice(-6)}` : receiver}." />
  <!-- Twitter Card data -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@goplausible_ai">
  <meta name="twitter:creator" content="@GoPlausible">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${uriType} for ${note && note.length > 0 ? note + ' | ' : ''} ${prettyAmount} from ${typeof sender === 'string' && sender.length > 12 ? `${sender.slice(0, 6)}...${sender.slice(-6)}` : sender} to ${typeof receiver === 'string' && receiver.length > 12 ? `${receiver.slice(0, 6)}...${receiver.slice(-6)}` : receiver}.">
  <meta name="twitter:image" content="${qrPng}" type="image/jpeg">
  <!-- Open Graph data -->
  <meta property="og:image" content="${qrPng}" type="image/jpeg""/>
  <meta property="og:domain" content="goplausible.xyz" />
  <meta property="og:url" content="https://goplausible.xyz/api/receipt/${uuid}" />
  <meta property="og:title" content="${title}"/>
  <meta property="og:type" content="website" />
  <meta property="og:description"  content="${uriType} for ${note && note.length > 0 ? note + ' | ' : ''} ${prettyAmount} from ${typeof sender === 'string' && sender.length > 12 ? `${sender.slice(0, 6)}...${sender.slice(-6)}` : sender} to ${typeof receiver === 'string' && receiver.length > 12 ? `${receiver.slice(0, 6)}...${receiver.slice(-6)}` : receiver}." />

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
    .url {
      font-size: 0.85rem;
      font-family: monospace;
      word-break: break-all;
      background: #f1f5f9;
      padding: 0.75rem;
      border-radius: 6px;
    }
     
    .shareBtn {
      /* make circular */
      width: 32px;
      height: 32px;
      padding: 0;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background-color: #1DA1F2;
      border: none;
      color: white;
      text-align: center;
      text-decoration: none;
      font-size: 18px;
      line-height: 1;
      margin: 4px 2px;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(29,161,242,0.4);
      transition: background-color 0.2s ease, transform 0.08s ease;
    }
    .shareBtn:hover {
      background-color: #0d8ddb;
      transform: translateY(-1px);
    }
    .shareBtn:active {
      transform: translateY(0);
    }
    .shareBtn:focus {
      outline: none;
      box-shadow: 0 0 0 3px rgba(29,161,242,0.18);
    }
  </style>
  <link
  rel="stylesheet"
  href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"
/>
  <script src="https://cdn.jsdelivr.net/npm/sharer.js@0.5.2/sharer.min.js"></script>
</head>
<body>
  <div class="card">
    
     <img src="https://agency.goplausible.xyz/images/Agent.png" alt="${provider === 'twitter' ? 'X' : provider === 'google' ? 'Google' : provider === 'linkedin' ? 'Linkedin' : provider === 'github' ? 'GitHub' : provider === 'algorand' ? 'Agency' : ''}" style="width:64px; height:64px; border-radius:50%; object-fit:cover; margin-bottom:1rem;" />

    <h2><strong>👋 Hey ${provider === 'twitter' ? '@' : ''}${provider === 'algorand' ? `${from.slice(0, 6)}...${from.slice(-6)}` : from}</strong></h2>
    
    <h3>Your ${uriType}</h3>
     <h2>${label}</h2>
    <hr style="border: none; height: 1px; background: linear-gradient(90deg, rgba(0,0,0,0.08), rgba(0,0,0,0.02)); margin: 1rem 0 1.5rem;" />
     <h4 title="${sender}">From: ${typeof sender === 'string' && sender.length > 12 ? `${sender.slice(0, 6)}...${sender.slice(-6)}` : sender}</h4>
     <h4 title="${receiver}">To: ${typeof receiver === 'string' && receiver.length > 12 ? `${receiver.slice(0, 6)}...${receiver.slice(-6)}` : receiver}</h4>
     <h4>Amount: ${prettyAmount}</h4>
     <h4>Asset/Algo: ${asset || 'Algo'}</h4>
     <h4>Transaction: <a href="https://allo.info/tx/${txId}" target="_blank" rel="noopener noreferrer">${`${txId.slice(0, 6)}...${txId.slice(-6)}`}</a></h4>
     <h4>Agent Owner : ${provider === 'algorand' ? from.slice(0, 6) + '...' + from.slice(-6) : from}</h4>
     <h4>Authentication: ${provider === 'twitter' ? 'X via dOAuth' : provider === 'google' ? 'Google via dOAuth' : provider === 'linkedin' ? 'Linkedin via dOAuth' : provider === 'github' ? 'GitHub via dOAuth' : provider === 'algorand' ? 'Algorand Agency via dOAuth' : ''}</h4>
     <h4>Note: ${note && note.length > 0 ? note : title}</h4>


    <div class="qr">
      ${qrPng ? `<img src="${qrPng}" alt="${label}" style="
        width: 100%;
        box-shadow: 0 4px 14px #607D8B;
        border-radius: 25px;"
        />` : '<p>No QR code available</p>'}
    </div>

    <button class="shareBtn" data-sharer="x" data-title="${title}\n" data-hashtags="algorand,agency,goplausible,agentic_commerce" data-url="${url}\n\n"><i class="fa-brands fa-x-twitter"></i></button>
    <button class="shareBtn" data-sharer="linkedin" data-title="${title}\n" data-hashtags="algorand,agency,goplausible,agentic_commerce" data-url="${url}\n\n"> <i class="fa-brands fa-linkedin"></i></button>
    <button class="shareBtn" data-sharer="facebook" data-title="${title}\n" data-hashtags="algorand,agency,goplausible, agentic_commerce" data-url="${url}\n\n"><i class="fa-brands fa-facebook"></i></button>
    <button class="shareBtn" data-sharer="email" data-title="${title}\n" data-hashtags="algorand,agency,goplausible,agentic_commerce" data-url="${url}\n\n"><i class="fa-solid fa-envelope"></i></button>
    <button class="shareBtn" data-sharer="whatsapp" data-title="${title}\n" data-hashtags="algorand,agency,goplausible,agentic_commerce" data-url="${url}\n\n"> <i class="fa-brands fa-whatsapp"></i></button>
    <button class="shareBtn" data-sharer="telegram" data-title="${title}\n" data-hashtags="algorand,agency,goplausible,agentic_commerce" data-url="${url}\n\n"> <i class="fa-brands fa-telegram"></i></button>
    
    <div class="url">${url}</div>
   
    <img style="width:120px; height:40px;" src="https://goplausible.mypinata.cloud/ipfs/QmWjvCGPyL9zmA5B84WPqLYF27dL2nFgr1Lw6rMd7CpQPV/images/goPlausible-logo-type-h.png" alt="GoPlausible" />
    <div style="margin-top: 1rem; font-size: 0.5rem; color: #718096;">
      <a href="https://doauth.org" target="_blank" rel="noopener noreferrer">doAuth.org</a> &nbsp;|&nbsp;
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


async function generateAlgorandReceipt(params: any): Promise<{ url: string; qrCode: string }> {
  // Validate address format (base32 string)
  if (!params.sender || !/^[A-Z2-7]{58}$/.test(params.sender)) {
    throw new Error('Invalid Algorand sender address format');
  }
  if (!params.receiver || !/^[A-Z2-7]{58}$/.test(params.receiver)) {
    throw new Error('Invalid Algorand receiver address format');
  }
  //TODO: check other params validity

  // Start building the url with the scheme and address
  const url = `https://goplausible.xyz/api/receipt/${params.uuid}`;

  console.log('Generated URL:', url);
  const pngBuffer = await generate(url, 'png', {
    ecLevel: 'H',
    scale: 8,
    margin: 2,
  });
  console.log('Generated PNG Buffer length:', pngBuffer.length);
  const blank = PhotonImage.new_from_base64(getBgPng().split(',')[1]);
  console.log('Created blank image');
  const qrImg = PhotonImage.new_from_byteslice(new Uint8Array(pngBuffer));
  console.log('Created QR image from PNG buffer');
  console.log('Resized QR image');
  const x = Math.floor((blank.get_width() - qrImg.get_width()) / 2);
  const y = Math.floor((blank.get_height() - qrImg.get_height()) / 2);
  console.log(`Calculated position to center QR: (${x}, ${y})`);
  try {
    await watermark(blank, qrImg, BigInt(x), BigInt(y));
  } catch (error) {
    console.error('Error during watermarking:', error);
  }
  console.log('Merged QR onto blank image');

  const jpegBytes = blank.get_bytes_jpeg(100); // quality: 0–100
  console.log('Converted merged image to JPEG bytes');

  return {
    url,
    qrCode: Buffer.from(new Uint8Array(jpegBytes)).toString('base64')
  };
}
/**
 * Register Receipt tools to the MCP server
 */
export function registerReceiptTools(server: McpServer, env: Env, props: Props): void {
  console.log('Registering Receipt tools for Algorand Remote MCP');

  server.tool(
    'generate_algorand_receipt',
    'Generate a Receipt and QRCode of it, for an Algorand payment or asset transfer',
    {
      sender: z.string().describe('Algorand address (58 characters)'),
      receiver: z.string().describe('Algorand address (58 characters)'),
      amount: z.number().optional().describe('Amount in microAlgos (for payment) or asset units (for asset transfer)'),
      assetId: z.number().optional().describe('Asset ID (for asset transfer)'),
      txId: z.string().describe('Transaction hash'),
      note: z.string().optional().describe('Optional note')
    },
    async ({ sender, receiver, amount, assetId, note, txId }) => {
      try {
        const uuid = crypto.randomUUID().replaceAll('-', '');
        const toolArgs: any = {
          sender,
          receiver,
          amount,
          asset: assetId,
          txId,
          note,
          uuid
        };
        console.log('Generating Receipt with args:', toolArgs);

        const { url, qrCode } = await generateAlgorandReceipt(toolArgs);
        console.log('Generated Receipt URL:', url);
        console.log('Generated Receipt QR Code (base64 PNG):', qrCode);
        await env.ARC26_KV?.put(`image--${uuid}`, qrCode, { expirationTtl: 86400 * 7 }); // Cache for 7 days

        const htmlPage = buildHTMLPage({
          provider: props.provider,
          url,
          uuid,
          qrPng: `https://goplausible.xyz/api/receipt/image/${uuid}.jpeg`,
          from: props.email,
          sender,
          txId,
          receiver,
          amount,
          asset: assetId,
          note,
        })
        await env.ARC26_KV?.put(`rid--${uuid}`, htmlPage, { expirationTtl: 86400 * 7 }); // Cache for 7 days

        return ResponseProcessor.processResponse({
          label: `Algorand Agency Receipt link (valid for 7 days)`,
          qrcode_link: `https://goplausible.xyz/api/receipt/${uuid}`,
        });


      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Error generating Algorand Receipt: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );
}
