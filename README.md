solana program deploy ./target/deploy/spl_token_upgrade.so && solana program deploy --program-id ./target/deploy/spl_token_upgrade-keypair.json ./target/deploy/spl_token_upgrade.so

rm -rf test-ledger && solana-test-validator

DEBUG=log:* yarn test-1.17
