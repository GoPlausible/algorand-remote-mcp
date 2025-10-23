// const getPaymentMethods = tool({
//   description: "list shopper-available payment methods with balances",
//   inputSchema: z.object({}),
//   execute: async () => {
//     console.log("[ShopperTools] getPaymentMethods invoked");
//     return [
//       {
//         id: "x402-payment-usdc-algorand",
//         label: "X402 Payment provider with USDC on Algorand",
//         settlement: "instant",
//         fee: "0",
//         notes:
//           "Zero chargeback risk; Zero fees; requires an Algorand wallet. Shopper wallet info attached.",
//         address: "ALGO1SHOPPERWALLET234567890123456789012345678901234567",
//         balance: "785 USDC",

//       }
//     ];
//   }
// });