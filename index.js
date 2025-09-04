import "dotenv/config";
import { ethers } from "ethers";

// --- Configuration ---
const RPC_URL = process.env.RPC_URL;
const privateKeys = process.env.PRIVATE_KEY.split(',');
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS;
const USDT_ADDRESS = process.env.USDT_ADDRESS;
const ETH_ADDRESS = process.env.ETH_ADDRESS;
const BTC_ADDRESS = process.env.BTC_ADDRESS;

// --- New Delay Configuration ---
const MIN_DELAY_MS = 10000; // 10 seconds
const MAX_DELAY_MS = 30000; // 30 seconds

// --- ABIs ---
const ROUTER_ABI = [
  {
    "inputs": [
      {
        "components": [
          { "internalType": "address", "name": "tokenIn", "type": "address" },
          { "internalType": "address", "name": "tokenOut", "type": "address" },
          { "internalType": "uint24", "name": "fee", "type": "uint24" },
          { "internalType": "address", "name": "recipient", "type": "address" },
          { "internalType": "uint256", "name": "deadline", "type": "uint256" },
          { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
          { "internalType": "uint256", "name": "amountOutMinimum", "type": "uint256" },
          { "internalType": "uint160", "name": "sqrtPriceLimitX96", "type": "uint160" }
        ],
        "internalType": "struct ISwapRouter.ExactInputSingleParams",
        "name": "params",
        "type": "tuple"
      }
    ],
    "name": "exactInputSingle",
    "outputs": [{ "internalType": "uint256", "name": "amountOut", "type": "uint256" }],
    "stateMutability": "payable",
    "type": "function"
  }
];
const ERC20_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function balanceOf(address account) view returns (uint256)",
];

// --- Setup ---
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallets = privateKeys.map(pk => new ethers.Wallet(pk.trim(), provider));

// --- Helper Functions ---
const log = (message) => console.log(`[${new Date().toLocaleString()}] ${message}`);
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- New Countdown Timer Function ---
async function startCountdown(ms) {
    let seconds = Math.floor(ms / 1000);
    for (let i = seconds; i > 0; i--) {
        // This will write the countdown on a single line in the terminal
        process.stdout.write(`Waiting for ${i} seconds... \r`);
        await delay(1000);
    }
    // Print a newline character after the countdown is finished
    process.stdout.write("\n");
}


// --- Core Functions ---
async function approveToken(tokenAddress, wallet, amount) {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
    try {
        const allowance = await tokenContract.allowance(wallet.address, ROUTER_ADDRESS);
        if (allowance >= amount) {
            log(`[${wallet.address.slice(0, 6)}] Allowance is sufficient.`);
            return true;
        }
        log(`[${wallet.address.slice(0, 6)}] Approving token...`);
        const tx = await tokenContract.approve(ROUTER_ADDRESS, amount);
        await tx.wait();
        log(`[${wallet.address.slice(0, 6)}] Approval successful.`);
        return true;
    } catch (error) {
        log(`[${wallet.address.slice(0, 6)}] Approval failed: ${error.message}`);
        return false;
    }
}

async function performSwap(fromToken, toToken, amountIn, wallet) {
    const swapContract = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, wallet);
    const deadline = Math.floor(Date.now() / 1000) + 120; // 2 minutes

    const params = {
        tokenIn: fromToken.address,
        tokenOut: toToken.address,
        fee: 3000,
        recipient: wallet.address,
        deadline,
        amountIn,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0n,
    };

    try {
        log(`[${wallet.address.slice(0, 6)}] Attempting swap: ${ethers.formatUnits(amountIn, fromToken.decimals)} ${fromToken.symbol} -> ${toToken.symbol}`);
        const tx = await swapContract.exactInputSingle(params, { gasLimit: 250000 });
        const receipt = await tx.wait();
        if (receipt.status === 1) {
            log(`✅ [${wallet.address.slice(0, 6)}] Swap successful! Tx: ${receipt.hash}`);
            return true;
        } else {
            log(`❌ [${wallet.address.slice(0, 6)}] Swap transaction failed.`);
            return false;
        }
    } catch (error) {
        log(`❌ [${wallet.address.slice(0, 6)}] Swap error: ${error.message}`);
        return false;
    }
}

// --- Automation Logic ---
async function main() {
    log(`🚀 Automation bot started with ${wallets.length} wallet(s).`);

    const tokens = {
        USDT: { symbol: 'USDT', address: USDT_ADDRESS, decimals: 18 },
        ETH: { symbol: 'ETH', address: ETH_ADDRESS, decimals: 18 },
        BTC: { symbol: 'BTC', address: BTC_ADDRESS, decimals: 18 },
    };

    const swapCycle = [
        { from: tokens.USDT, to: tokens.ETH, amount: ethers.parseUnits("1", tokens.USDT.decimals) },
        { from: tokens.ETH,  to: tokens.USDT, amount: ethers.parseUnits("0.0001", tokens.ETH.decimals) },
        { from: tokens.BTC,  to: tokens.ETH, amount: ethers.parseUnits("0.00001", tokens.BTC.decimals) },
        { from: tokens.ETH,  to: tokens.BTC, amount: ethers.parseUnits("0.001", tokens.ETH.decimals) },
    ];
    
    const walletStates = wallets.map(() => ({ cycleIndex: 0 }));

    while (true) {
        for (let i = 0; i < wallets.length; i++) {
            const wallet = wallets[i];
            const state = walletStates[i];
            const currentSwap = swapCycle[state.cycleIndex];
            const { from, to, amount } = currentSwap;

            log(`--- Wallet: ${wallet.address.slice(0, 6)} | Task: ${from.symbol} -> ${to.symbol} ---`);
            
            const tokenContract = new ethers.Contract(from.address, ERC20_ABI, provider);
            const balance = await tokenContract.balanceOf(wallet.address);

            if (balance < amount) {
                log(`⚠️ Insufficient balance of ${from.symbol}. Required: ${ethers.formatUnits(amount, from.decimals)}, Have: ${ethers.formatUnits(balance, from.decimals)}`);
            } else {
                const isApproved = await approveToken(from.address, wallet, amount);
                if (isApproved) {
                    await performSwap(from, to, amount, wallet);
                }
            }

            state.cycleIndex = (state.cycleIndex + 1) % swapCycle.length;
            
            // --- Updated Delay Logic ---
            const randomDelayMs = Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;
            await startCountdown(randomDelayMs);
        }
    }
}

main().catch((error) => {
    console.error("A critical error occurred:", error);
    process.exit(1);
});
