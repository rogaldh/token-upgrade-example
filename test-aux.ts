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

const cli = "../solana-program-library/target/debug/spl-token-upgrade";

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
  const payerKeypairFilename =
    "./.keys/pyr9uxfH4z2yts3qtXT74D5BxfAE16HEDvWTyAjUMNF.json";
  const pyrKeypair = readJSONSync(payerKeypairFilename);
  const payer = web3.Keypair.fromSecretKey(readAsUInt8(pyrKeypair));
  //const payer = web3.Keypair.generate();
  const wallet = {
    payer: payer,
    publicKey: payer.publicKey,
  };

  const holderKeypairFilename =
    "./.keys/h1dry4DqG4U45iN5Nfs6YrqHY82H4P1nBu3VKFQ9cty.json";
  const holderKeypair = web3.Keypair.fromSecretKey(
    readAsUInt8(readJSONSync(holderKeypairFilename))
  );
  const holder = holderKeypair.publicKey;

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
  const escKeypair = readJSONSync(`./.keys/${escrowKeypairFileName}`);
  const escrowKeypair = web3.Keypair.fromSecretKey(readAsUInt8(escKeypair));

  describe("when executing transfer", () => {
    it("should perform successfully", async () => {
      let balance = await connection.getBalance(wallet.publicKey);
      log(`Balance: ${balance}`);

      const sig = await connection.requestAirdrop(
        wallet.publicKey,
        web3.LAMPORTS_PER_SOL
      );
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
      log(await spl.getMint(connection, oldKeypair.publicKey));
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
        newKeypair,
        undefined,
        spl.TOKEN_2022_PROGRAM_ID
      );
      log(`New mint created: ${newToken}`);
      log(
        await spl.getMint(
          connection,
          newKeypair.publicKey,
          undefined,
          spl.TOKEN_2022_PROGRAM_ID
        )
      );
      const newATA = await spl.createAccount(
        connection,
        wallet.payer,
        newToken,
        wallet.publicKey,
        undefined,
        undefined,
        spl.TOKEN_2022_PROGRAM_ID
      );
      log(`New ATA created: ${newATA}`);
      log(
        await spl.getAccount(
          connection,
          newATA,
          undefined,
          spl.TOKEN_2022_PROGRAM_ID
        )
      );

      log("Creating escrow account...");
      const command = `${cli} -u ${URL} create-escrow ${oldKeypair.publicKey} ${newKeypair.publicKey} ./.keys/${escrowKeypairFileName}`;
      log(`Command: ${command}`);
      spawnSubcommandSync(command, []);
      log("Escrow account created");
      log(
        await spl.getAccount(
          connection,
          escrowKeypair.publicKey,
          undefined,
          spl.TOKEN_2022_PROGRAM_ID
        )
      );

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

      log("Minting new token to the escrow...");
      const mintNewToEscrowTx = new web3.Transaction().add(
        spl.createMintToInstruction(
          newToken,
          escrowKeypair.publicKey,
          wallet.publicKey,
          100e8,
          undefined,
          spl.TOKEN_2022_PROGRAM_ID
        )
      );
      mintNewToEscrowTx.recentBlockhash = (
        await connection.getRecentBlockhash()
      ).blockhash;
      mintNewToEscrowTx.feePayer = wallet.publicKey;
      await connection.simulateTransaction(mintNewToEscrowTx, [wallet.payer]);
      const b = await web3.sendAndConfirmTransaction(
        connection,
        mintNewToEscrowTx,
        [wallet.payer]
      );
      //await spl.mintTo(
      //connection,
      //wallet.payer,
      //newToken,
      //newATA, //escrowKeypair.publicKey,
      //wallet.payer,
      //100,
      //undefined,
      //undefined,
      //spl.TOKEN_2022_PROGRAM_ID
      //);

      //await spl.transferChecked(
      //connection,
      //wallet.payer,
      //newATA,
      //newToken,
      //escrowKeypair.publicKey,
      //wallet.publicKey,
      //100,
      //8,
      //undefined,
      //undefined,
      //spl.TOKEN_2022_PROGRAM_ID
      //);
      log(`Minted successfully: ${b}`);
      const escrowAccountInfo = await spl.getAccount(
        connection,
        escrowKeypair.publicKey,
        undefined,
        spl.TOKEN_2022_PROGRAM_ID
      );
      log(`New token was minted. Amount: ${escrowAccountInfo.amount}`);

      log("Creating mint recipient");
      //const user = web3.Keypair.generate();
      //const holder = user.publicKey;
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

      const holderBalanceSig = await connection.requestAirdrop(
        holder,
        web3.LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(holderBalanceSig);

      balance = await connection.getBalance(holder);
      log(`Holder balance: ${balance}`);

      const holderNewTokenATA = await spl.getOrCreateAssociatedTokenAccount(
        connection,
        wallet.payer,
        newToken,
        holder,
        undefined,
        undefined,
        undefined,
        spl.TOKEN_2022_PROGRAM_ID
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
        )
      );
      transferCheckedTx.recentBlockhash = (
        await connection.getRecentBlockhash()
      ).blockhash;
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

      //const delegateAccount = new web3.PublicKey(
      //"Fnq5ZpKGJ2AveXEx2VPJCT3357VLLsCe86jASjpmdVKF"
      //); //escrowKeypair.publicKey;

      //[>new web3.PublicKey(
      //"8FtJENBd9DssjCctLMch5kQaLLoaYDaoPZej5ZzEXZLb"
      //) */
      //[>holder<]

      //log("Delegate oldToken to the escrow...");
      //const approveInstruction = spl.createApproveInstruction(
      //holderTokenATA.address,
      //delegateAccount,
      //holder,
      //AMOUNT_TO_UPGRADE
      //);

      //const approveTx = new web3.Transaction().add(approveInstruction);
      //approveTx.recentBlockhash = await (
      //await connection.getRecentBlockhash()
      //).blockhash;
      //approveTx.feePayer = wallet.payer.publicKey;

      //await web3.sendAndConfirmTransaction(connection, approveTx, [
      //wallet.payer,
      //user,
      //]);

      //const accountWithDelegation = await spl.getAccount(
      //connection,
      //holderTokenATA.address
      //);
      //log(
      //`Delegated ${accountWithDelegation.delegatedAmount} of ${oldToken} tokens to ${accountWithDelegation.delegate}`
      //);

      balance = await connection.getBalance(wallet.publicKey);
      log(`Balance: ${balance}`);

      log("Exchanging old tokens for the new ones...");
      const exchangeCommand = `../solana-program-library/target/debug/spl-token-upgrade -u ${URL} exchange ${oldKeypair.publicKey} ${newKeypair.publicKey} --escrow ${escrowKeypair.publicKey} --owner ${holderKeypairFilename} --payer ${payerKeypairFilename}`; // --burn-from ${holderTokenATA.address} --destination ${holderNewTokenATA.address} --owner ${payerKeypairFilename} --payer ${payerKeypairFilename}`;
      log(`Executing command: ${exchangeCommand}`);
      spawnSubcommandSync(exchangeCommand, []);

      const newAccount = await spl.getAccount(
        connection,
        holderNewTokenATA.address,
        undefined,
        spl.TOKEN_2022_PROGRAM_ID
      );

      console.log("|>", newAccount);

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
