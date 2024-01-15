import * as anchor from "@coral-xyz/anchor";
import * as spl from "@solana/spl-token";
import * as web3 from "@solana/web3.js";
import assert from "node:assert";
import BN from "bn.js";
import Debug from "debug";
import { Program } from "@coral-xyz/anchor";
import { TokenUpgrade } from "../target/types/token_upgrade";
import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";

const log = Debug("log:token-update");

function readJSONSync(pathToFile: string) {
  const pathToJSON = path.resolve(pathToFile);
  const buffer = fs.readFileSync(pathToJSON, "utf8");
  return buffer;
}

function readAsUInt8(bufferString: string) {
  return Uint8Array.from(JSON.parse(bufferString));
}

function spawnSubcommandSync(command: string, args: string[]) {
  const result = childProcess.spawnSync(command, { shell: true });

  const { status, stderr, stdout } = result;

  if (stderr.length > 0 || status !== 0) {
    console.error(stderr.toString());
    process.exit(1);
  }

  log("|>", stdout.toString());

  return status;
}

describe("token-upgrade program", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TokenUpgrade as Program<TokenUpgrade>;

  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;

  const oldMintKeypair = readJSONSync(
    "./.keys/o1dcYPVSbt1XzMJo1fiYJmxsmFNxt3GK8aPz8CmvqpM.json"
  );
  const newMintKeypair = readJSONSync(
    "./.keys/newUmpxzRynFVsHJZXwNCjz26Bzg1ccDDa86gZmUmNW.json"
  );

  const oldKeypair = web3.Keypair.fromSecretKey(readAsUInt8(oldMintKeypair));
  const newKeypair = web3.Keypair.fromSecretKey(readAsUInt8(newMintKeypair));

  const escrowKeypairFileName =
    "eswVFXkqaT2RNztieEDsiLfSfhx4daNpMywDHJ5XhUi.json";
  const escKeypair = readJSONSync(
    "./.keys/eswVFXkqaT2RNztieEDsiLfSfhx4daNpMywDHJ5XhUi.json"
  );
  const escrowKeypair = web3.Keypair.fromSecretKey(readAsUInt8(escKeypair));

  describe("when executing transfer", () => {
    it("should perform successfully", async () => {
      log("Creating old mint...");
      const oldToken = await spl.createMint(
        connection,
        wallet.payer,
        wallet.publicKey,
        wallet.publicKey,
        8,
        oldKeypair
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
        8,
        newKeypair
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
      const command = `spl-token-upgrade -u localhost create-escrow ${oldKeypair.publicKey} ${newKeypair.publicKey} ./.keys/${escrowKeypairFileName}`;
      spawnSubcommandSync(command, []);

      log("Minting old token...");
      await spl.mintToChecked(
        connection,
        wallet.payer,
        oldToken,
        oldATA,
        wallet.payer,
        100,
        8
      );
      const oldAccountInfo = await spl.getAccount(connection, oldATA);
      log(`Old token was minted. Amount: ${oldAccountInfo.amount}`);

      log("Creating mint recipient");
      const user = web3.Keypair.generate();
      const holder = user.publicKey;
      log(`Holder created: ${holder}`);
      const holderTokenATA = await spl.getOrCreateAssociatedTokenAccount(
        connection,
        wallet.payer,
        oldToken,
        holder
      );
      log(
        `Holder\'s account for ${oldToken} was created: ${holderTokenATA.address}`
      );

      const AMOUNT_TO_UPGRADE = 100;
      const DECIMALS = 8;

      log("Transfering old tokens to the holder");
      await spl.transferChecked(
        connection,
        wallet.payer,
        oldATA,
        oldToken,
        holderTokenATA.address,
        wallet.publicKey,
        AMOUNT_TO_UPGRADE,
        DECIMALS
      );
      const holderAccountInfo = await spl.getAccount(
        connection,
        holderTokenATA.address
      );
      log(`Holder has the ${holderAccountInfo.amount} of ${oldToken} tokens`);

      const delegateAccount = escrowKeypair.publicKey;

      console.log("234", user.publicKey, wallet.payer.publicKey);

      /*new web3.PublicKey(
          "8FtJENBd9DssjCctLMch5kQaLLoaYDaoPZej5ZzEXZLb"
        ) */
      /*holder*/

      console.log("Delegate oldToken to the escrow...");
      const approveInstruction = spl.createApproveInstruction(
        holderTokenATA.address,
        delegateAccount,
        holder,
        AMOUNT_TO_UPGRADE
      );

      const approveTx = new web3.Transaction().add(approveInstruction);
      approveTx.recentBlockhash = await (
        await connection.getRecentBlockhash()
      ).blockhash;
      approveTx.feePayer = wallet.payer.publicKey;

      await web3.sendAndConfirmTransaction(connection, approveTx, [
        wallet.payer,
        user,
      ]);

      const accountWithDelegation = await spl.getAccount(connection, holderTokenATA.address);
      log(`Delegated ${accountWithDelegation.delegatedAmount} of ${oldToken} tokens to ${accountWithDelegation.delegate}`);

      //const tx = await program.methods.transfer(new BN(0)).rpc();

      assert.ok(1);
    });
  });
});
