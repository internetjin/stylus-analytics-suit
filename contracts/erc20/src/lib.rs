// Minimal Stylus ERC-20 used as a fixture by the analyzer CLI.
//
// Note: a real 4-byte selector collision cannot be embedded in the Rust
// source -- stylus-sdk catches that at compile time (it runs the same check
// as M2). To exercise M2 against this contract, scripts/build-real-fixtures.sh
// augments the exported ABI after the fact with a pre-mined colliding pair
// (`f8491()` / `f130736()`), simulating an ABI from any toolchain that
// doesn't enforce the check (Solidity, Vyper, raw WASM, on-chain artifacts).

#![cfg_attr(not(any(feature = "export-abi", test)), no_main)]
extern crate alloc;

use alloc::{string::String, vec::Vec};
use stylus_sdk::{
    alloy_primitives::{Address, U256},
    prelude::*,
    storage::{StorageMap, StorageU256},
};

#[storage]
#[entrypoint]
pub struct Erc20 {
    balances: StorageMap<Address, StorageU256>,
    allowances: StorageMap<Address, StorageMap<Address, StorageU256>>,
    total_supply: StorageU256,
}

#[public]
impl Erc20 {
    pub fn name(&self) -> String {
        "Test Token".into()
    }

    pub fn symbol(&self) -> String {
        "TST".into()
    }

    pub fn decimals(&self) -> u8 {
        18
    }

    pub fn total_supply(&self) -> U256 {
        self.total_supply.get()
    }

    pub fn balance_of(&self, owner: Address) -> U256 {
        self.balances.get(owner)
    }

    pub fn transfer(&mut self, to: Address, amount: U256) -> bool {
        let from = self.vm().msg_sender();
        let bal = self.balances.get(from);
        if bal < amount {
            return false;
        }
        self.balances.setter(from).set(bal - amount);
        let to_bal = self.balances.get(to);
        self.balances.setter(to).set(to_bal + amount);
        true
    }

    pub fn approve(&mut self, spender: Address, amount: U256) -> bool {
        let owner = self.vm().msg_sender();
        self.allowances.setter(owner).setter(spender).set(amount);
        true
    }

    pub fn allowance(&self, owner: Address, spender: Address) -> U256 {
        self.allowances.getter(owner).getter(spender).get()
    }

    pub fn transfer_from(&mut self, from: Address, to: Address, amount: U256) -> bool {
        let spender = self.vm().msg_sender();
        let allowed = self.allowances.getter(from).getter(spender).get();
        if allowed < amount {
            return false;
        }
        let bal = self.balances.get(from);
        if bal < amount {
            return false;
        }
        self.allowances.setter(from).setter(spender).set(allowed - amount);
        self.balances.setter(from).set(bal - amount);
        let to_bal = self.balances.get(to);
        self.balances.setter(to).set(to_bal + amount);
        true
    }

    pub fn mint(&mut self, to: Address, amount: U256) {
        let bal = self.balances.get(to);
        self.balances.setter(to).set(bal + amount);
        let supply = self.total_supply.get();
        self.total_supply.set(supply + amount);
    }
}
