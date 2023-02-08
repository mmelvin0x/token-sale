import * as anchor from "@project-serum/anchor";
import { Program, BN, IdlAccounts } from "@project-serum/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
} from "@solana/spl-token";
import { TokenSale } from "../target/types/token_sale";
import NodeWallet from "@project-serum/anchor/dist/cjs/nodewallet";
import { assert } from "chai";

type TokenSaleAccount = IdlAccounts<TokenSale>["tokenSale"];

describe("Token Sale", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TokenSale as Program<TokenSale>;

  const initializerAmount = new BN("2000000");
  const takerAmount = new BN("500000");
  const numClaims = new BN("0");
  const maxClaims = new BN("4");
  const fee = new BN((0.1 * LAMPORTS_PER_SOL).toString());

  const initializer = provider.wallet.publicKey;
  const payer = (provider.wallet as NodeWallet).payer;
  const taker = Keypair.generate();
  const escrowTokenAccount = Keypair.generate();

  let account: any;
  let mint: PublicKey;
  let initializerTokenAccount: PublicKey;
  let takerTokenAccount: PublicKey;
  let escrow: PublicKey;

  before(async () => {
    // Airdrop SOL to taker
    await provider.connection.requestAirdrop(
      taker.publicKey,
      1 * LAMPORTS_PER_SOL
    );

    // Airdrop SOL to initializer
    await provider.connection.requestAirdrop(initializer, 1 * LAMPORTS_PER_SOL);

    // Derive escrow address
    [escrow] = PublicKey.findProgramAddressSync(
      [anchor.utils.bytes.utf8.encode("token_sale"), initializer.toBytes()],
      program.programId
    );

    // Create a test token
    mint = await createMint(
      provider.connection,
      payer,
      initializer,
      initializer,
      1
    );

    // Get token accounts
    initializerTokenAccount = await createAccount(
      provider.connection,
      payer,
      mint,
      initializer
    );
    takerTokenAccount = await createAccount(
      provider.connection,
      payer,
      mint,
      taker.publicKey
    );

    // Mint test tokens
    await mintTo(
      provider.connection,
      payer,
      mint,
      initializerTokenAccount,
      payer,
      initializerAmount.toNumber()
    );
  });

  describe("Initialize Token Sale", () => {
    before(async () => {
      await program.methods
        .initializeTokenSale(initializerAmount, takerAmount, fee, maxClaims)
        .accounts({
          initializer,
          mint,
          initializerTokenAccount,
          escrow,
          escrowTokenAccount: escrowTokenAccount.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .signers([escrowTokenAccount])
        .rpc();

      account = (await program.account.tokenSale.all())[0].account;
    });

    it("should set the authority", async () => {
      assert.isTrue(initializer.equals(account.authority));
    });

    it("should set the mint", async () => {
      assert.isTrue(mint.equals(account.mint));
    });

    it("should set the initializerTokenAccount", async () => {
      assert.isTrue(
        initializerTokenAccount.equals(account.initializerTokenAccount)
      );
    });

    it("should set the escrowTokenAccount", async () => {
      assert.isTrue(
        escrowTokenAccount.publicKey.equals(account.escrowTokenAccount)
      );
    });

    it("should set the escrow initializerAmount", async () => {
      assert.equal(
        account.initializerAmount.toString(),
        initializerAmount.toString()
      );
    });

    it("should set the escrow takerAmount", async () => {
      assert.equal(account.takerAmount.toString(), takerAmount.toString());
    });

    it("should set the escrow tokensRemaining", async () => {
      assert.equal(
        account.tokensRemaining.toString(),
        initializerAmount.toString()
      );
    });

    it("should set the numClaims", async () => {
      assert.equal(account.numClaims.toString(), numClaims.toString());
    });

    it("should set the maxClaims", async () => {
      assert.equal(account.maxClaims.toString(), maxClaims.toString());
    });

    it("should set the fee", async () => {
      assert.equal(account.fee.toString(), fee.toString());
    });

    it("should set the bump", async () => {
      assert.exists(account.bump);
    });
  });

  describe("Sell Tokens", () => {
    let initializerStartingLamports: string;
    let initializerEndingLamports: string;

    let takerStartingLamports: string;
    let takerStartingTokenAmount: string;
    let takerEndingLamports: string;
    let takerEndingTokenAmount: string;

    before(async () => {
      initializerStartingLamports = (
        await provider.connection.getBalance(initializer)
      ).toString();

      takerStartingLamports = (
        await provider.connection.getBalance(taker.publicKey)
      ).toString();
      takerStartingTokenAmount = (
        await provider.connection.getTokenAccountBalance(takerTokenAccount)
      ).value.amount;

      await program.methods
        .sellTokens()
        .accounts({
          taker: taker.publicKey,
          initializer,
          escrow,
          escrowTokenAccount: escrowTokenAccount.publicKey,
          takerTokenAccount,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([taker])
        .rpc();

      initializerEndingLamports = (
        await provider.connection.getBalance(initializer)
      ).toString();

      takerEndingLamports = (
        await provider.connection.getBalance(taker.publicKey)
      ).toString();
      takerEndingTokenAmount = (
        await provider.connection.getTokenAccountBalance(takerTokenAccount)
      ).value.amount;

      account = (await program.account.tokenSale.all())[0].account;
    });

    it("should send the fee from the taker to the initializer", async () => {
      assert.closeTo(
        +initializerStartingLamports + fee.toNumber(),
        +initializerEndingLamports,
        10_001
      );

      assert.closeTo(
        +takerStartingLamports - fee.toNumber(),
        +takerEndingLamports,
        10_001
      );
    });

    it("should send the escrowed tokens to the taker account", async () => {
      assert.equal(+takerStartingTokenAmount, 0);
      assert.equal(takerEndingTokenAmount, takerAmount.toString());
    });

    it("should increment the numClaims", async () => {
      assert.equal(account.numClaims.toString(), "1");
    });

    it("should decrement the tokensRemaining", async () => {
      assert.equal(
        account.tokensRemaining.toString(),
        (initializerAmount.toNumber() - takerAmount.toNumber()).toString()
      );
    });
  });

  describe("Cancel Token Sale", () => {
    let initializerEndingTokenAmount: string;
    let accountBeforeCloseTokenAmount: string;

    before(async () => {
      account = (await program.account.tokenSale.all())[0].account;
      accountBeforeCloseTokenAmount = account.tokensRemaining;

      await program.methods
        .cancelTokenSale()
        .accounts({
          initializer,
          escrow,
          escrowTokenAccount: escrowTokenAccount.publicKey,
          initializerTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      initializerEndingTokenAmount = (
        await provider.connection.getTokenAccountBalance(
          initializerTokenAccount
        )
      ).value.amount;
    });

    it("should return the remaining tokens to the initializer", async () => {
      const account = (await program.account.tokenSale.all())[0];
      assert.equal(initializerEndingTokenAmount, accountBeforeCloseTokenAmount);
      assert.notExists(account);
    });

    it("should close the TokenSale account", async () => {
      const account = (await program.account.tokenSale.all())[0];
      assert.notExists(account);
    });
  });
});
