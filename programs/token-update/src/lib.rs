use anchor_lang::prelude::*;

declare_id!("7oTo4ZQQwPSpErvAEw75bPWMbRULiBfEFeeA69i6dU8w");

#[program]
pub mod token_update {
    use super::*;

    pub fn update(ctx: Context<Update>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Update {}
