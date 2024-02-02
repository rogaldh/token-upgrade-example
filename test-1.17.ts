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

const TOKEN_UPGRADE_PROGRAM_ID = new web3.PublicKey(
  "GHscxHuEzVwEiEqu2WQ9FLww72hQzYxhVp3i2ncJJp5"
);

const cli = "../solana-program-library/target/debug/spl-token-upgrade";

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

async function enrichTxWithRecentInfo(
  connection: web3.Connection,
  tx: web3.Transaction,
  payer: web3.PublicKey
) {
  tx.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
  tx.feePayer = payer;

  return tx;
}

async function sendAndConfirmTransaction(
  connection: web3.Connection,
  tx: web3.Transaction,
  payer: web3.PublicKey,
  signers: web3.Keypair[]
) {
  let t9n = await enrichTxWithRecentInfo(connection, tx, payer);

  await connection.simulateTransaction(t9n, signers);
  const sig = await web3.sendAndConfirmTransaction(connection, t9n, signers);

  return sig;
}

const upgradeTokenInstructionData = 1; //struct([1]);

function addSigners(keys, ownerOrAuthority, multiSigners) {
  if (multiSigners.length) {
    keys.push({ pubkey: ownerOrAuthority, isSigner: false, isWritable: false });
    for (const signer of multiSigners) {
      keys.push({
        pubkey: signer instanceof web3.PublicKey ? signer : signer.publicKey,
        isSigner: true,
        isWritable: false,
      });
    }
  } else {
    keys.push({ pubkey: ownerOrAuthority, isSigner: true, isWritable: false });
  }
  return keys;
}

function upgradeTokenInstruction(
  originalAccount: web3.PublicKey,
  originalMint: web3.PublicKey,
  newEscrow: web3.PublicKey,
  newAccount: web3.PublicKey,
  newMint: web3.PublicKey,
  originalTransferAuthority: web3.PublicKey,
  originalMultisigSigners: (web3.Signer | web3.PublicKey)[] = [],
  programId: web3.PublicKey = TOKEN_UPGRADE_PROGRAM_ID,
  originalTokenProgramId = spl.TOKEN_PROGRAM_ID,
  newTokenProgramId = spl.TOKEN_2022_PROGRAM_ID
) {
  const [escrowAuthority] = web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("token-escrow-authority"),
      originalMint.toBuffer(),
      newMint.toBuffer(),
    ],
    programId
  );

  let keys = [
    { pubkey: originalAccount, isSigner: false, isWritable: true },
    { pubkey: originalMint, isSigner: false, isWritable: true },
    { pubkey: newEscrow, isSigner: false, isWritable: true },
    { pubkey: newAccount, isSigner: false, isWritable: true },
    { pubkey: newMint, isSigner: false, isWritable: true },
    { pubkey: escrowAuthority, isSigner: false, isWritable: false },
    { pubkey: originalTokenProgramId, isSigner: false, isWritable: false },
    { pubkey: newTokenProgramId, isSigner: false, isWritable: false },
  ];
  keys = addSigners(keys, originalTransferAuthority, originalMultisigSigners);

  const data = Buffer.alloc(upgradeTokenInstructionData /*.span*/);

  return new web3.TransactionInstruction({ keys, programId, data });
}

describe("token-upgrade program", () => {
  const connection = new web3.Connection("http://127.0.0.1:8899", "confirmed");

  // PAYER
  const payerKeypairFilename =
    "./.keys/pyr9uxfH4z2yts3qtXT74D5BxfAE16HEDvWTyAjUMNF.json";
  const payerKeypair = readJSONSync(payerKeypairFilename);
  const payer = web3.Keypair.fromSecretKey(readAsUInt8(payerKeypair));
  const wallet = {
    payer: payer,
    publicKey: payer.publicKey,
  };

  // HOLDER
  const holderKeypairFilename =
    "./.keys/h1dry4DqG4U45iN5Nfs6YrqHY82H4P1nBu3VKFQ9cty.json";
  const holderKeypair = web3.Keypair.fromSecretKey(
    readAsUInt8(readJSONSync(holderKeypairFilename))
  );
  const holder = holderKeypair.publicKey;

  // OLD MINT
  const oldMintKeypair = readJSONSync(
    "./.keys/o1dcYPVSbt1XzMJo1fiYJmxsmFNxt3GK8aPz8CmvqpM.json"
  );
  const oldKeypair = web3.Keypair.fromSecretKey(readAsUInt8(oldMintKeypair));

  // NEW MINT
  const newMintKeypair = readJSONSync(
    "./.keys/newUmpxzRynFVsHJZXwNCjz26Bzg1ccDDa86gZmUmNW.json"
  );
  const newKeypair = web3.Keypair.fromSecretKey(readAsUInt8(newMintKeypair));

  // ESCROW
  const escrowKeypairFileName =
    "./.keys/eswVFXkqaT2RNztieEDsiLfSfhx4daNpMywDHJ5XhUi.json";
  const escKeypair = readJSONSync(escrowKeypairFileName);
  const escrowKeypair = web3.Keypair.fromSecretKey(readAsUInt8(escKeypair));

  describe("when executing transfer", () => {
    it("should perform successfully", async () => {
      let balance = await connection.getBalance(wallet.publicKey);
      log(`Current balance: ${balance}`);

      let holderBalance = await connection.getBalance(holder);
      log(`Holder balance: ${holderBalance}`);

      const SOURCE_TOKEN_DECIMALS = 8;
      const AMOUNT_TO_TRANSFER = 100;

      // Airdrop 2 payer
      const sigPayer = await connection.requestAirdrop(
        wallet.publicKey,
        web3.LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(sigPayer);
      // END

      // Airdrop 2 holder
      const sigHolder = await connection.requestAirdrop(
        holder,
        web3.LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(sigHolder);
      // END

      // Request balances
      log(`Holder: ${holder}`);
      log(`Payer: ${wallet.publicKey}`);

      balance = await connection.getBalance(wallet.publicKey);
      log(`New payer balance: ${balance}`);

      holderBalance = await connection.getBalance(holder);
      log(`New holder balance: ${holderBalance}`);
      // END

      // Prepare old token
      log("Creating old mint...");
      const oldToken = await spl.createMint(
        connection,
        wallet.payer,
        wallet.publicKey,
        wallet.publicKey,
        SOURCE_TOKEN_DECIMALS,
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
      log("Minting old token...");
      await spl.mintTo(
        connection,
        wallet.payer,
        oldToken,
        oldATA,
        wallet.payer,
        AMOUNT_TO_TRANSFER * Math.pow(10, SOURCE_TOKEN_DECIMALS)
      );
      const oldAccountInfo = await spl.getAccount(connection, oldATA);
      log(`Old token was minted. Amount: ${oldAccountInfo.amount}`);
      log("Transfering old tokens to the holder");
      const holderATA = await spl.createAccount(
        connection,
        payer,
        oldToken,
        holder
      );
      const transferOldTokenTx = new web3.Transaction().add(
        spl.createTransferCheckedInstruction(
          oldATA,
          oldToken,
          holderATA,
          wallet.publicKey,
          AMOUNT_TO_TRANSFER * Math.pow(10, SOURCE_TOKEN_DECIMALS),
          SOURCE_TOKEN_DECIMALS
        )
      );
      await sendAndConfirmTransaction(
        connection,
        transferOldTokenTx,
        wallet.publicKey,
        [wallet.payer]
      );
      // END

      // Prepare new token
      log("Creating new mint...");
      const newToken = await spl.createMint(
        connection,
        wallet.payer,
        wallet.publicKey,
        wallet.publicKey,
        SOURCE_TOKEN_DECIMALS,
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
      // Create escrow
      log("Creating escrow account...");
      const command = `${cli} -u ${URL} create-escrow ${oldKeypair.publicKey} ${newKeypair.publicKey} ${escrowKeypairFileName}`;
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
      // Mint new token to escrow
      log("Minting new token to the escrow...");
      let mintNewToEscrowTx = new web3.Transaction().add(
        spl.createMintToInstruction(
          newToken,
          escrowKeypair.publicKey,
          wallet.publicKey,
          100e8,
          undefined,
          spl.TOKEN_2022_PROGRAM_ID
        )
      );
      const mint2022 = await sendAndConfirmTransaction(
        connection,
        mintNewToEscrowTx,
        wallet.publicKey,
        [wallet.payer]
      );
      log(`Mint Token2022 transaction created: ${mint2022}`);
      // END

      // Anciliary creation
      const anciliaryAccountKeypair = web3.Keypair.generate();
      log(`Anciliary account: ${anciliaryAccountKeypair.publicKey}`);
      // END

      const [holderNewTokenATA1] = web3.PublicKey.findProgramAddressSync(
        [
          holder.toBuffer(),
          spl.TOKEN_2022_PROGRAM_ID.toBuffer(),
          newToken.toBuffer(),
        ],
        spl.ASSOCIATED_TOKEN_PROGRAM_ID
      );

      log(`Holder newToken ATA: ${holderNewTokenATA1}`);

      // Exchanging tokens
      const mintAccountRentExtemption =
        await spl.getMinimumBalanceForRentExemptAccount(connection);

      const exchangeTx = new web3.Transaction().add(
        web3.SystemProgram.createAccount({
          fromPubkey: holder,
          newAccountPubkey: anciliaryAccountKeypair.publicKey,
          lamports: mintAccountRentExtemption,
          space: spl.ACCOUNT_SIZE,
          programId: spl.TOKEN_PROGRAM_ID,
        }),
        spl.createInitializeAccountInstruction(
          anciliaryAccountKeypair.publicKey,
          oldToken,
          holder
        ),
        spl.createTransferInstruction(
          holderATA,
          anciliaryAccountKeypair.publicKey,
          holder,
          (AMOUNT_TO_TRANSFER / 2) * Math.pow(10, SOURCE_TOKEN_DECIMALS)
        ),
        spl.createAssociatedTokenAccountIdempotentInstruction(
          holder,
          holderNewTokenATA1,
          holder,
          newToken,
          spl.TOKEN_2022_PROGRAM_ID
        ),
        upgradeTokenInstruction(
          anciliaryAccountKeypair.publicKey, // tokenaccount should be here
          oldToken,
          escrowKeypair.publicKey,
          holderNewTokenATA1,
          newToken,
          holder
        )
        // close anciliary token account
      );
      const sig = await sendAndConfirmTransaction(
        connection,
        exchangeTx,
        holder,
        [holderKeypair, anciliaryAccountKeypair]
      );

      console.log("sig", sig);

      return;

      // Creating auxiliary token account
      log("Creating auxiliary token account...");
      const auxATA = await spl.createAccount(
        connection,
        payer,
        oldToken,
        holder
      );
      log(`Auxiliary account created: ${auxATA} `);
      //const createAuxiliaryTokenAccountInstruction = spl.createAssociatedTokenAccountIdempotentInstruction(payer, associatedToken, owner, mint)
      // END

      // Minting
      const transferTokenToAuxAccountInstruction =
        spl.createTransferCheckedInstruction(
          oldATA,
          oldToken,
          auxATA,
          holder,
          AMOUNT_TO_TRANSFER,
          SOURCE_TOKEN_DECIMALS
        );

      return;
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
