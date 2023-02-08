use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_instruction::transfer;
use anchor_lang::solana_program::program::invoke;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};

declare_id!("EUH9RrCQfQhu1Fq4X1Y6x8NSGsxeAbPynckM8M71M4ph");

#[program]
pub mod token_sale {
    use super::*;

    pub fn initialize_token_sale(
        ctx: Context<InitializeTokenSale>,
        initializer_amount: u64,
        taker_amount: u64,
        fee: u64,
        max_claims: u64,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;

        if escrow.initializer_amount > 0 {
            return err!(TokenSaleError::TokenSaleAlreadyInitialized)
        }
        
        escrow.initializer_amount = initializer_amount;
        escrow.tokens_remaining = initializer_amount;
        escrow.taker_amount = taker_amount;
        escrow.num_claims = 0;
        escrow.max_claims = max_claims;
        escrow.fee = fee;

        escrow.bump = *ctx.bumps.get("escrow").unwrap();
        escrow.authority = ctx.accounts.initializer.key();
        escrow.mint = ctx.accounts.mint.key();
        escrow.initializer_token_account = ctx.accounts.initializer_token_account.key();
        escrow.escrow_token_account = ctx.accounts.escrow_token_account.key();

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.initializer_token_account.to_account_info(),
                    to: ctx.accounts.escrow_token_account.to_account_info(),
                    authority: ctx.accounts.initializer.to_account_info(),
                }
            ),
            initializer_amount
        )?;

        Ok(())
    }

    pub fn sell_tokens(ctx: Context<SellTokens>) -> Result<()> {
        // Transferring the fee from the taker to the initializer.
        invoke(&
            transfer(
                ctx.accounts.taker.key, 
                ctx.accounts.initializer.key,
                 ctx.accounts.escrow.fee
            ),
            &[
                ctx.accounts.taker.to_account_info(),
                ctx.accounts.initializer.to_account_info()
            ]
        )?;

        // Transferring escrowed tokens to the buyer
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    to: ctx.accounts.taker_token_account.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                &[&["token_sale".as_bytes(), ctx.accounts.escrow.authority.as_ref(), &[ctx.accounts.escrow.bump]]],
            ),
            ctx.accounts.escrow.taker_amount,
        )?;

        ctx.accounts.escrow.num_claims += 1;
        ctx.accounts.escrow.tokens_remaining = ctx.accounts
            .escrow.tokens_remaining - ctx.accounts
            .escrow.taker_amount;

        Ok(())
    }

    pub fn cancel_token_sale(ctx: Context<CancelTokenSale>) -> Result<()> {
        // Return the initializer's tokens
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(), 
                Transfer {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    to: ctx.accounts.initializer_token_account.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                &[
                    &[
                        "token_sale".as_bytes(),
                        ctx.accounts.initializer.key().as_ref(),
                        &[ctx.accounts.escrow.bump]
                    ]
                ],
            ),
            ctx.accounts.escrow_token_account.amount
        )?;

        // Close the account
        token::close_account(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::CloseAccount {
                    account: ctx.accounts.escrow_token_account.to_account_info(),
                    destination: ctx.accounts.initializer.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info()
                },
                &[
                    &[
                        "token_sale".as_bytes(),
                        ctx.accounts.initializer.key().as_ref(),
                        &[ctx.accounts.escrow.bump]
                    ]
                ]
            )
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(initializer_amount: u64, taker_amount: u64, fee: u64, max_claims: u64)]
pub struct InitializeTokenSale<'info> {
    #[account(mut)]
    initializer: Signer<'info>,

    #[account(mut)]
    mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = initializer_token_account.mint == mint.key(),
        constraint = initializer_token_account.owner == initializer.key(),
    )]
    initializer_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = initializer,
        space = 8 + TokenSale::LEN,
        seeds = ["token_sale".as_bytes(), initializer.key().as_ref()],
        bump,
    )]
    escrow: Account<'info, TokenSale>,

    #[account(
        init,
        payer = initializer,
        token::mint = mint,
        token::authority = escrow
    )]
    escrow_token_account: Account<'info, TokenAccount>,

    token_program: Program<'info, Token>,
    rent: Sysvar<'info, Rent>,
    system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SellTokens<'info> {
    #[account(mut)]
    taker: Signer<'info>,
    /// CHECK: this is safe bc it is how you pass in Signer's in Anchor
    #[account(mut)]
    initializer: AccountInfo<'info>,

    #[account(
        mut,
        seeds = ["token_sale".as_bytes(), escrow.authority.as_ref()],
        bump = escrow.bump,
    )]
    escrow: Account<'info, TokenSale>,

    #[account(
        mut,
        constraint = escrow_token_account.key() == escrow.escrow_token_account,
    )]
    escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = taker_token_account.mint == escrow_token_account.mint)]
    taker_token_account: Account<'info, TokenAccount>,

    system_program: Program<'info, System>,
    token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelTokenSale<'info> {
    #[account(mut)]
    initializer: Signer<'info>,

    #[account(
        mut,
        close = initializer,
        constraint = escrow.authority == initializer.key(),
        seeds = ["token_sale".as_bytes(), escrow.authority.as_ref()],
        bump = escrow.bump,
    )]
    escrow: Account<'info, TokenSale>,

    #[account(
        mut,
        constraint = escrow_token_account.key() == escrow.escrow_token_account,
    )]
    escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = initializer_token_account.mint == escrow_token_account.mint,
        constraint = initializer_token_account.owner == initializer.key()
    )]
    initializer_token_account: Account<'info, TokenAccount>,

    token_program: Program<'info, Token>,
}

#[account]
pub struct TokenSale {
    authority: Pubkey,                  // 32
    mint: Pubkey,                       // 32
    initializer_token_account: Pubkey,  // 32
    escrow_token_account: Pubkey,       // 32
    initializer_amount: u64,            // 8
    taker_amount: u64,                  // 8
    tokens_remaining: u64,              // 8
    num_claims: u64,                    // 8
    max_claims: u64,                    // 8
    fee: u64,                           // 8
    bump: u8,                           // 1
}

impl TokenSale {
    /// Defining the length of the TokenSale struct.
    pub const LEN: usize = 32 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 1;
}

#[error_code]
pub enum TokenSaleError {
    #[msg("All of the tokens have been claimed!")]
    AllTokensClaimed,
    #[msg("Token sale is already initialized!")]
    TokenSaleAlreadyInitialized
}

