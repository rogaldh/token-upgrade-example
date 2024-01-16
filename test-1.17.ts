import * as anchor from "@coral-xyz/anchor";
import * as spl from "@solana/spl-token";
import * as web3 from "@solana/web3.js";
import assert from "node:assert";
import BN from "bn.js";
import Debug from "debug";
import { struct, u8 } from "@solana/buffer-layout";
import { Program } from "@coral-xyz/anchor";
import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
const log = Debug("log:token-update");

const URL = process.env.ENVIRON || "localhost";

//enum AuthorityType {
//TokenUpgrade = 100,
//}

//interface TokenUpgradeInstructionData {
//instruction: AuthorityType.TokenUpgrade,
//authorityType: AuthorityType
//}

//const tokenUpgradeInstructionData = struct<TokenUpgradeInstructionData>([
//u8('instruction')
//])

//function createTokenUpgradeInstruction(
//account: web3.PublicKey,
//currentAuthority: web3.PublicKey,
//multiSigners: (web3.Signer | web3.PublicKey)[] = [],
//programID: web3.PublicKey = spl.TOKEN_PROGRAM_ID,
//){
//const keys= util.addSigners([{ pubkey: account, isSigner: false, isWritable: true }], currentAuthority, multiSigners)

//const programId = programID;

//const data = Buffer.alloc(tokenUpgradeInstructionData.span);
//tokenUpgradeInstructionData.encode({
//instruction: AuthorityType.TokenUpgrade,
//authorityType:
//}, data);

//return new web3.TransactionInstruction({
//keys, programId, data

//});
//}

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
  //const provider = anchor.AnchorProvider.env();
  //anchor.setProvider(provider);

  //const program = anchor.workspace.TokenUpgrade as Program<TokenUpgrade>;


  //const connection = provider.connection;
  const connection = new web3.Connection("http://127.0.0.1:8899", "confirmed");
  //const wallet = provider.wallet as anchor.Wallet;
  const payer = web3.Keypair.generate();
  const wallet = {
    payer: payer,
    publicKey: payer.publicKey,
  }


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
      let balance = await connection.getBalance(wallet.publicKey);
      log(`Balance: ${balance}`);

      const sig = await connection.requestAirdrop(wallet.publicKey, web3.LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);

      balance = await connection.getBalance(wallet.publicKey);
      log(`Balance: ${balance}`);


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
      const command = `spl-token-upgrade -u ${URL} create-escrow ${oldKeypair.publicKey} ${newKeypair.publicKey} ./.keys/${escrowKeypairFileName}`;
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

      const holderNewTokenATA = await spl.getOrCreateAssociatedTokenAccount(
        connection,
        wallet.payer,
        newToken,
        holder
      );
      log(
        `Holder\'s account for ${newToken} was created: ${holderNewTokenATA.address}`
      );

      const AMOUNT_TO_UPGRADE = 100;
      const DECIMALS = 8;

      log("Transfering old tokens to the holder");
      const transferCheckedTx = new web3.Transaction().add(
        spl.createTransferCheckedInstruction(
          oldATA,
          oldToken,
          holderTokenATA.address,
          wallet.publicKey,
          AMOUNT_TO_UPGRADE,
          DECIMALS
      ));
      transferCheckedTx.recentBlockhash = await (await connection.getRecentBlockhash()).blockhash
      transferCheckedTx.feePayer = wallet.payer.publicKey;

      await web3.sendAndConfirmTransaction(connection, transferCheckedTx, [
        wallet.payer,
      ]);
      //await spl.transferChecked(
        //connection,
        //wallet.payer,
        //oldATA,
        //oldToken,
        //holderTokenATA.address,
        //wallet.publicKey,
        //AMOUNT_TO_UPGRADE,
        //DECIMALS
      //);
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

      const accountWithDelegation = await spl.getAccount(
        connection,
        holderTokenATA.address
      );
      log(
        `Delegated ${accountWithDelegation.delegatedAmount} of ${oldToken} tokens to ${accountWithDelegation.delegate}`
      );

      log("Exchanging old tokens for the new ones...");
      const exchangeCommand = `spl-token-upgrade -u ${URL} exchange ${oldKeypair.publicKey} ${newKeypair.publicKey} --escrow ${escrowKeypair.publicKey} --burn-from ${holderTokenATA.address} --destination ${holderNewTokenATA.address}`;
      log(`Executing command: ${exchangeCommand}`);
      spawnSubcommandSync(exchangeCommand, []);

      const newAccount = await spl.getAccount(
        connection,
        holderNewTokenATA.address
      );

      console.log(newAccount);

      //const exchangeInstruction = new web3.TransactionInstruction({});

      //const exchangeTx = new web3.Transaction().add(exchangeInstruction);
      //exchangeTx.recentBlockhash = await (
      //await connection.getRecentBlockhash()
      //).blockhash;
      //approveTx.feePayer = wallet.payer.publicKey;

      //console.log({ exchangeInstruction });

      //const tx = await program.methods.transfer(new BN(0)).rpc();

      assert.ok(1);
    });
  });
});
