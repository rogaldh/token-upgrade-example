use anchor_lang::prelude::*;
use anchor_spl::token::Mint;
use anchor_lang::solana_program;
//use spl_token_upgrade;
//use spl_token_2022::*;
//use spl_token::*;

pub fn transfer(ctx: Context<Transfer>, _amount: u64) -> Result<()> {
    //let escrow_authority = spl_token_upgrade::get_token_upgrade_authority_address(
        //ctx.original_mint,
        //ctx.new_mint,
        //&spl_token_upgrade::id(),
    //);

    Ok(())
}

#[derive(Accounts)]
pub struct Transfer<'info> {
    #[account()]
    original_mint: Account<'info, Mint>,
    #[account()]
    new_mint: Account<'info, Mint>,
}
