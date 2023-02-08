import * as anchor from "@coral-xyz/anchor";
import { Program, ProgramAccount } from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import {
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { BN } from "bn.js";
import { TokenSale } from "../target/types/token_sale";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function deployAndInitialize(provider: anchor.AnchorProvider) {
  anchor.setProvider(provider);
  const payer = (provider.wallet as NodeWallet).payer;
  const program = anchor.workspace.TokenSale as Program<TokenSale>;

  let escrow: PublicKey;
  let bump: number;

  const _initializerAmount = "348484848484847100";
  const _takerAmount = "694204204200";
  const _fee = (0.1 * LAMPORTS_PER_SOL).toString();
  const _maxClaims = "501991";

  const initializerAmount = new BN(_initializerAmount);
  const takerAmount = new BN(_takerAmount);
  const fee = new BN(_fee);
  const maxClaims = new BN(_maxClaims);

  const systemProgram = SystemProgram.programId;
  const tokenProgram = TOKEN_PROGRAM_ID;

  const escrowTokenAccount = Keypair.generate();
  const initializer = provider.wallet.publicKey;
  // Production Mint
  // const mint = new PublicKey("BHo73XYeApooxUiodo3uKVCRFyhoZEcZAX3EtW3QMghx");
  // Test Mint
  const mint = new PublicKey("5Q9CuE7VNH8CG7zqmcLmXjvVHsH6mtsZeVHGq6hqhppH");
  const tokenForSale = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    mint,
    initializer
  );

  [escrow, bump] = PublicKey.findProgramAddressSync(
    [anchor.utils.bytes.utf8.encode("token_sale"), initializer.toBytes()],
    program.programId
  );

  console.log("\n");
  console.log(
    "***************************************************************"
  );
  console.log(
    "**************   Initializing a Token Sale   ******************"
  );
  console.log(
    "***************************************************************"
  );
  console.log("\n");
  console.log("Escrow Token Account:", escrowTokenAccount.publicKey.toString());
  console.log("Initializer:", initializer.toString());
  console.log("Mint:", mint.toString());
  console.log("Mint Token Account:", tokenForSale.address.toString());
  console.log("Escrow:", escrow.toString());
  console.log("Bump:", bump.toString());

  const tx = await program.methods
    .initializeTokenSale(initializerAmount, takerAmount, fee, maxClaims)
    .accounts({
      initializer,
      mint,
      initializerTokenAccount: tokenForSale.address,
      escrow,
      escrowTokenAccount: escrowTokenAccount.publicKey,
      tokenProgram,
      rent: SYSVAR_RENT_PUBKEY,
      systemProgram,
    })
    .signers([escrowTokenAccount])
    .rpc();

  console.log("\n");
  console.log("Transaction:", tx);
  console.log("Waiting 3 minutes...");
  await sleep(60_000 * 3);

  const accounts = await program.account.tokenSale.all();

  if (accounts.length) {
    console.log("\n");
    console.log("Program Accounts:");
    accounts.forEach((account: ProgramAccount) => {
      console.log(`\tPublic Key: ${account.publicKey}`);
      console.log(`\tAccount:`);
      console.log(`\t\tAuthority: ${account.account.authority}`);
      console.log(
        `\t\tEscrow Token Account: ${account.account.escrowTokenAccount}`
      );
      console.log(
        `\t\tInitializer Amount: ${(
          account.account.initializerAmount / 10
        ).toString()}`
      );
      console.log(
        `\t\tTaker Amount: ${(account.account.takerAmount / 10).toString()}`
      );
      console.log(
        `\t\tTokens Remaining: ${(
          account.account.tokensRemaining / 10
        ).toString()}`
      );
      console.log(
        `\t\tNumber of Claims Made: ${account.account.numClaims.toString()}`
      );
      console.log(
        `\t\tMax Claims Allowed: ${account.account.maxClaims.toString()}`
      );
      console.log(
        `\t\tFee: ${(account.account.fee / LAMPORTS_PER_SOL).toString()}`
      );
    });
  } else {
    console.log("Program Accounts:", accounts);
  }
}

async function cancelAndClose(provider: anchor.AnchorProvider) {
  anchor.setProvider(provider);
  const program = anchor.workspace.TokenSale as Program<TokenSale>;

  const tokenProgram = TOKEN_PROGRAM_ID;
  let accounts = await program.account.tokenSale.all();
  const account = accounts[0].account;
  const initializer = provider.wallet.publicKey;
  const [escrow] = PublicKey.findProgramAddressSync(
    [anchor.utils.bytes.utf8.encode("token_sale"), initializer.toBytes()],
    program.programId
  );

  console.log("\n");
  console.log(
    "***************************************************************"
  );
  console.log(
    "******************   Closing Token Sale   *********************"
  );
  console.log(
    "***************************************************************"
  );
  console.log("\n");
  console.log("Program Accounts:");
  accounts.forEach((account: ProgramAccount) => {
    console.log(`\tPublic Key: ${account.publicKey}`);
    console.log(`\tAccount:`);
    console.log(`\t\tAuthority: ${account.account.authority}`);
    console.log(
      `\t\tEscrow Token Account: ${account.account.escrowTokenAccount}`
    );
    console.log(
      `\t\tInitializer Amount: ${(
        account.account.initializerAmount / 10
      ).toString()}`
    );
    console.log(
      `\t\tTaker Amount: ${(account.account.takerAmount / 10).toString()}`
    );
    console.log(
      `\t\tTokens Remaining: ${(
        account.account.tokensRemaining / 10
      ).toString()}`
    );
    console.log(
      `\t\tNumber of Claims Made: ${account.account.numClaims.toString()}`
    );
    console.log(
      `\t\tMax Claims Allowed: ${account.account.maxClaims.toString()}`
    );
    console.log(
      `\t\tFee: ${(account.account.fee / LAMPORTS_PER_SOL).toString()}`
    );
  });

  const tx = await program.methods
    .cancelTokenSale()
    .accounts({
      initializer,
      escrow,
      escrowTokenAccount: account.escrowTokenAccount,
      initializerTokenAccount: account.initializerTokenAccount,
      tokenProgram,
    })
    .rpc();

  console.log("\n");
  console.log("Transaction:", tx);
  console.log("Waiting 3 minutes...");
  await sleep(60_000 * 3);

  accounts = await program.account.tokenSale.all();

  if (accounts.length) {
    console.log("\n");
    console.log("Program Accounts:");
    accounts.forEach((account: ProgramAccount) => {
      console.log(`\tPublic Key: ${account.publicKey}`);
      console.log(`\tAccount:`);
      console.log(`\t\tAuthority: ${account.account.authority}`);
      console.log(
        `\t\tEscrow Token Account: ${account.account.escrowTokenAccount}`
      );
      console.log(
        `\t\tInitializer Amount: ${(
          account.account.initializerAmount / 10
        ).toString()}`
      );
      console.log(
        `\t\tTaker Amount: ${(account.account.takerAmount / 10).toString()}`
      );
      console.log(
        `\t\tTokens Remaining: ${(
          account.account.tokensRemaining / 10
        ).toString()}`
      );
      console.log(
        `\t\tNumber of Claims Made: ${account.account.numClaims.toString()}`
      );
      console.log(
        `\t\tMax Claims Allowed: ${account.account.maxClaims.toString()}`
      );
      console.log(
        `\t\tFee: ${(account.account.fee / LAMPORTS_PER_SOL).toString()}`
      );
    });
  } else {
    console.log("\n");
    console.log("Program Accounts:", accounts);
    console.log("Token Sale closed!");
  }
}

// Uncomment the below line to deploy and initialize the TokenSale program
module.exports = deployAndInitialize;

// Uncomment the below line to cancel and close the TokenSale program
// module.exports = cancelAndClose;
