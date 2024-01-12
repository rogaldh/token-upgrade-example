use anchor_lang::prelude::*;

pub mod methods;
use methods::*;

declare_id!("7oTo4ZQQwPSpErvAEw75bPWMbRULiBfEFeeA69i6dU8w");

#[program]
pub mod token_upgrade {
    use super::*;

    pub fn mint(ctx: Context<Mint>) -> Result<()> {
        methods::mint(ctx)
    }

    pub fn transfer(ctx: Context<Transfer>, amount: u64) -> Result<()> {
        methods::transfer(ctx, amount)
    }
}
