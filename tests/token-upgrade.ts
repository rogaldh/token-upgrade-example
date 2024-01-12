import * as anchor from "@coral-xyz/anchor";
import * as spl from "@solana/spl-token";
import assert from "node:assert";
import Debug from "debug";
import { Program } from "@coral-xyz/anchor";
import { TokenUpgrade } from "../target/types/token_upgrade";

const log = Debug("log:token-update");

describe("token-upgrade program", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TokenUpgrade as Program<TokenUpgrade>;

  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;

  describe("when executing transfer", () => {
    it("should perform successfully", async () => {
      log("Creating old mint...");
      const oldToken = await spl.createMint(
        connection,
        wallet.payer,
        wallet.publicKey,
        wallet.publicKey,
        8
      );
      log(`Old mint created: ${oldToken}`);
      const oldATA = await spl.createAccount(
        connection,
        wallet.payer,
        oldToken,
        wallet.publicKey
      );
      log(`Old ATA created: ${oldATA}`);

      log("Creating new mint...");
      const newToken = await spl.createMint(
        connection,
        wallet.payer,
        wallet.publicKey,
        wallet.publicKey,
        8
      );
      log(`New mint created: ${newToken}`);
      const newATA = await spl.createAccount(
        connection,
        wallet.payer,
        newToken,
        wallet.publicKey
      );
      log(`Old ATA created: ${newATA}`);

      log("Creating escrow account...");

      const tx = await program.methods.transfer().rpc();

      assert.ok(1);
    });
  });
});
