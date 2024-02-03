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

const isLocal = URL === "localhost";

const TOKEN_UPGRADE_PROGRAM_ID = new web3.PublicKey(
  isLocal
    ? "GHscxHuEzVwEiEqu2WQ9FLww72hQzYxhVp3i2ncJJp5"
    : "78E75PkvQHEg3eRwdRCGg9GRSsUBV7LdvuGGqiALEn2e"
);

const cli = "../solana-program-library/target/debug/spl-token-upgrade";

async function sleep(t = 1500) {
  const p = new Promise((res) => {
    setTimeout(() => {
      res(undefined);
    }, t);
  });

  return p;
}

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

  return [status, stdout.toString()];
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

function grindKeypair(searchString) {
  if (!searchString.length) throw new Error("Wrong grid start");

  let result;
  let keypairCandidate;
  let i = 0;
  while (!result) {
    i++;
    keypairCandidate = web3.Keypair.generate();

    const src = searchString.slice(0, searchString.length);
    const trg = keypairCandidate.publicKey
      .toString()
      .slice(0, searchString.length);

    if (src.toUpperCase() === trg.toUpperCase()) {
      log(`Keypair was found: ${keypairCandidate.publicKey}`);
      result = keypairCandidate;
    } else if (i % 10000 === 0) log(`${i} keypares were grinded`);
  }

  return keypairCandidate;
}

describe("token-upgrade program", () => {
  const connection = new web3.Connection(
    isLocal ? "http://127.0.0.1:8899" : web3.clusterApiUrl("devnet"),
    "confirmed"
  );

  // PAYER
  const payerKeypairFilename =
    "./.keys/pyr9uxfH4z2yts3qtXT74D5BxfAE16HEDvWTyAjUMNF.json";
  const payerKeypair = readJSONSync(payerKeypairFilename);
  const payer = isLocal
    ? web3.Keypair.fromSecretKey(readAsUInt8(payerKeypair))
    : grindKeypair("pr");
  // END

  const wallet = {
    payer: payer,
    publicKey: payer.publicKey,
  };

  // HOLDER
  const holderKeypairFilename =
    "./.keys/h1dry4DqG4U45iN5Nfs6YrqHY82H4P1nBu3VKFQ9cty.json";
  const holderKeypair = isLocal
    ? web3.Keypair.fromSecretKey(
        readAsUInt8(readJSONSync(holderKeypairFilename))
      )
    : grindKeypair("hr");
  const holder = holderKeypair.publicKey;
  // END

  // OLD MINT
  const oldMintKeypair = readJSONSync(
    "./.keys/o1dcYPVSbt1XzMJo1fiYJmxsmFNxt3GK8aPz8CmvqpM.json"
  );
  const oldKeypair = isLocal
    ? web3.Keypair.fromSecretKey(readAsUInt8(oldMintKeypair))
    : grindKeypair("ot");
  // END

  // NEW MINT
  const newMintKeypair = readJSONSync(
    "./.keys/newUmpxzRynFVsHJZXwNCjz26Bzg1ccDDa86gZmUmNW.json"
  );
  const newKeypair = isLocal
    ? web3.Keypair.fromSecretKey(readAsUInt8(newMintKeypair))
    : grindKeypair("nt");
  // NEW

  // ESCROW
  const escrowKeypairFileName =
    "./.keys/eswVFXkqaT2RNztieEDsiLfSfhx4daNpMywDHJ5XhUi.json";
  const escKeypair = readJSONSync(escrowKeypairFileName);
  const escrowKeypair = isLocal
    ? web3.Keypair.fromSecretKey(readAsUInt8(escKeypair))
    : grindKeypair("ew");
  // END

  const idKeypairFileName = "../../.config/solana/id.json";
  const idKeypair = web3.Keypair.fromSecretKey(
    readAsUInt8(readJSONSync(idKeypairFileName))
  );

  describe("when executing transfer", () => {
    it("should perform successfully", async () => {
      const SOURCE_TOKEN_DECIMALS = 8;
      const AMOUNT_TO_TRANSFER = 100;

      let balance = await connection.getBalance(wallet.publicKey);
      log(`Current ${wallet.publicKey} balance: ${balance}`);

      await sleep();

      let holderBalance = await connection.getBalance(holder);
      log(`Holder ${holder} balance: ${holderBalance}`);

      await sleep();

      // Airdrop 2 payer
      if (isLocal) {
        const sigPayer = await connection.requestAirdrop(
          wallet.publicKey,
          web3.LAMPORTS_PER_SOL / 10
        );
        await connection.confirmTransaction(sigPayer);
      } else {
        await sendAndConfirmTransaction(
          connection,
          new web3.Transaction().add(
            web3.SystemProgram.transfer({
              fromPubkey: idKeypair.publicKey,
              toPubkey: wallet.publicKey,
              lamports: web3.LAMPORTS_PER_SOL / 10,
            })
          ),
          idKeypair.publicKey,
          [idKeypair]
        );
      }
      await sleep();
      // END

      // Airdrop 2 holder
      if (isLocal) {
        const sigHolder = await connection.requestAirdrop(
          holder,
          web3.LAMPORTS_PER_SOL / 10
        );
        await connection.confirmTransaction(sigHolder);
      } else {
        await sendAndConfirmTransaction(
          connection,
          new web3.Transaction().add(
            web3.SystemProgram.transfer({
              fromPubkey: idKeypair.publicKey,
              toPubkey: holder,
              lamports: web3.LAMPORTS_PER_SOL / 10,
            })
          ),
          idKeypair.publicKey,
          [idKeypair]
        );
      }
      await sleep();
      // END

      // Request balances
      balance = await connection.getBalance(wallet.publicKey);
      log(`New payer ${wallet.publicKey} balance: ${balance}`);
      await sleep();

      holderBalance = await connection.getBalance(holder);
      log(`New holder ${holder} balance: ${holderBalance}`);
      await sleep();
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
      await sleep();

      log(`Old mint created: ${oldToken}`);
      const oldATA = await spl.createAccount(
        connection,
        wallet.payer,
        oldToken,
        wallet.publicKey
      );
      await sleep();
      log(`Old ATA created: ${oldATA}`);
      log(await spl.getMint(connection, oldKeypair.publicKey));
      await sleep();

      log("Minting old token...");
      await spl.mintTo(
        connection,
        wallet.payer,
        oldToken,
        oldATA,
        wallet.payer,
        AMOUNT_TO_TRANSFER * Math.pow(10, SOURCE_TOKEN_DECIMALS)
      );
      await sleep();
      const oldAccountInfo = await spl.getAccount(connection, oldATA);
      log(`Old token was minted. Amount: ${oldAccountInfo.amount}`); // adjust according the decimals
      await sleep();
      // END

      // Transfer old token to the holder
      log("Transfering old tokens to the holder");
      const holderATA = await spl.createAccount(
        connection,
        payer,
        oldToken,
        holder
      );
      await sleep();
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
      await sleep();
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
      await sleep();
      log(
        await spl.getMint(
          connection,
          newKeypair.publicKey,
          undefined,
          spl.TOKEN_2022_PROGRAM_ID
        )
      );
      await sleep();
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
      await sleep();
      log(
        await spl.getAccount(
          connection,
          newATA,
          undefined,
          spl.TOKEN_2022_PROGRAM_ID
        )
      );
      await sleep();
      // END

      // Create escrow
      log("Creating escrow account...");
      const [tokenUpgradeAuthority] = web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("token-escrow-authority"),
          oldToken.toBuffer(),
          newToken.toBuffer(),
        ],
        TOKEN_UPGRADE_PROGRAM_ID
      );
      log(`Calculated Escrow address: ${tokenUpgradeAuthority}`);
      //await sleep();
      //await spl.createAssociatedTokenAccountIdempotent(connection, idKeypair, tokenUpgradeAuthority, TOKEN_UPGRADE_PROGRAM_ID,undefined,TOKEN_UPGRADE_PROGRAM_ID)

      //await sleep();
      //const escrow = await spl.getOrCreateAssociatedTokenAccount(
      //connection,
      //wallet.payer,
      //newToken,
      //tokenUpgradeAuthority,
      //true,
      //undefined,
      //undefined,
      //spl.TOKEN_2022_PROGRAM_ID
      //);
      //log(`Escrow account created: ${escrow.address}`;

      const command = `${cli} -u ${URL} create-escrow ${oldKeypair.publicKey} ${newKeypair.publicKey}`;
      log(`Command: ${command}`);
      const [,msg] = spawnSubcommandSync(command, []);
      const escrowAccount = new web3.PublicKey((msg as string).split(" ")[3]);
      log(`Generated scrow account: ${escrowAccount}`);

      await sleep();
      //log(
      //await spl.getAccount(
      //connection,
      //tokenUpgradeAuthority,
      //undefined,
      //spl.TOKEN_2022_PROGRAM_ID
      //)
      //);
      //await sleep();

      // Mint new token to escrow
      log("Minting new token to the escrow...");
      const mint2022 = await sendAndConfirmTransaction(
        connection,
        new web3.Transaction().add(
          spl.createMintToInstruction(
            newToken,
            //escrowKeypair.publicKey,
            escrowAccount,
            wallet.publicKey,
            100e8,
            undefined,
            spl.TOKEN_2022_PROGRAM_ID
          )
        ),
        wallet.publicKey,
        [wallet.payer]
      );
      log(`Mint Token2022 transaction created: ${mint2022}`);
      await sleep();
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
      await sleep();

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
          //escrowKeypair.publicKey,
          escrowAccount,
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
    });
  });
});
