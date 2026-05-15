// Stylus ERC-721 fixture, fleshed out enough that brotli-compressed size
// crosses M1's 80% warning threshold. Includes runtime-configurable name /
// symbol, per-token URIs, mint / burn, and an Enumerable-style index.

#![cfg_attr(not(any(feature = "export-abi", test)), no_main)]
extern crate alloc;

use alloc::{string::String, vec::Vec};
use stylus_sdk::{
    alloy_primitives::{Address, U256},
    prelude::*,
    storage::{
        StorageAddress, StorageBool, StorageMap, StorageString, StorageU256, StorageVec,
    },
};

#[storage]
#[entrypoint]
pub struct Erc721 {
    owners: StorageMap<U256, StorageAddress>,
    balances: StorageMap<Address, StorageU256>,
    token_approvals: StorageMap<U256, StorageAddress>,
    operator_approvals: StorageMap<Address, StorageMap<Address, StorageBool>>,
    name_: StorageString,
    symbol_: StorageString,
    base_uri: StorageString,
    token_uris: StorageMap<U256, StorageString>,
    next_token_id: StorageU256,
    total_supply_: StorageU256,
    all_tokens: StorageVec<StorageU256>,
    all_tokens_index: StorageMap<U256, StorageU256>,
    owned_tokens: StorageMap<Address, StorageVec<StorageU256>>,
    owned_tokens_index: StorageMap<U256, StorageU256>,
}

#[public]
impl Erc721 {
    pub fn set_name(&mut self, name: String) {
        self.name_.set_str(name);
    }

    pub fn set_symbol(&mut self, symbol: String) {
        self.symbol_.set_str(symbol);
    }

    pub fn set_base_uri(&mut self, uri: String) {
        self.base_uri.set_str(uri);
    }

    pub fn name(&self) -> String {
        self.name_.get_string()
    }

    pub fn symbol(&self) -> String {
        self.symbol_.get_string()
    }

    pub fn total_supply(&self) -> U256 {
        self.total_supply_.get()
    }

    pub fn balance_of(&self, owner: Address) -> U256 {
        self.balances.get(owner)
    }

    pub fn owner_of(&self, token_id: U256) -> Address {
        self.owners.get(token_id)
    }

    pub fn token_uri(&self, token_id: U256) -> String {
        let per_token = self.token_uris.getter(token_id).get_string();
        if !per_token.is_empty() {
            return per_token;
        }
        let mut uri = self.base_uri.get_string();
        uri.push_str(&token_id.to_string());
        uri
    }

    pub fn set_token_uri(&mut self, token_id: U256, uri: String) {
        let owner = self.owners.get(token_id);
        let caller = self.vm().msg_sender();
        if caller != owner {
            return;
        }
        self.token_uris.setter(token_id).set_str(uri);
    }

    pub fn approve(&mut self, to: Address, token_id: U256) {
        let owner = self.owners.get(token_id);
        let caller = self.vm().msg_sender();
        let is_operator = self.operator_approvals.getter(owner).getter(caller).get();
        if caller != owner && !is_operator {
            return;
        }
        self.token_approvals.setter(token_id).set(to);
    }

    pub fn get_approved(&self, token_id: U256) -> Address {
        self.token_approvals.get(token_id)
    }

    pub fn set_approval_for_all(&mut self, operator: Address, approved: bool) {
        let owner = self.vm().msg_sender();
        self.operator_approvals.setter(owner).setter(operator).set(approved);
    }

    pub fn is_approved_for_all(&self, owner: Address, operator: Address) -> bool {
        self.operator_approvals.getter(owner).getter(operator).get()
    }

    pub fn token_by_index(&self, index: U256) -> U256 {
        let idx: usize = index.try_into().unwrap_or(0);
        self.all_tokens
            .getter(idx)
            .map(|v| v.get())
            .unwrap_or(U256::ZERO)
    }

    pub fn token_of_owner_by_index(&self, owner: Address, index: U256) -> U256 {
        let idx: usize = index.try_into().unwrap_or(0);
        self.owned_tokens
            .getter(owner)
            .getter(idx)
            .map(|v| v.get())
            .unwrap_or(U256::ZERO)
    }

    pub fn mint(&mut self, to: Address) -> U256 {
        let token_id = self.next_token_id.get();
        self.next_token_id.set(token_id + U256::from(1u64));
        self.owners.setter(token_id).set(to);
        let bal = self.balances.get(to);
        self.balances.setter(to).set(bal + U256::from(1u64));

        let all_idx = U256::from(self.all_tokens.len());
        self.all_tokens_index.setter(token_id).set(all_idx);
        self.all_tokens.push(token_id);

        let mut owned = self.owned_tokens.setter(to);
        let owner_idx = U256::from(owned.len());
        self.owned_tokens_index.setter(token_id).set(owner_idx);
        owned.push(token_id);

        let supply = self.total_supply_.get();
        self.total_supply_.set(supply + U256::from(1u64));
        token_id
    }

    pub fn burn(&mut self, token_id: U256) {
        let owner = self.owners.get(token_id);
        let caller = self.vm().msg_sender();
        let is_operator = self.operator_approvals.getter(owner).getter(caller).get();
        if caller != owner && !is_operator {
            return;
        }
        self.owners.setter(token_id).set(Address::ZERO);
        self.token_approvals.setter(token_id).set(Address::ZERO);
        let bal = self.balances.get(owner);
        if bal > U256::ZERO {
            self.balances.setter(owner).set(bal - U256::from(1u64));
        }
        let supply = self.total_supply_.get();
        if supply > U256::ZERO {
            self.total_supply_.set(supply - U256::from(1u64));
        }
    }

    pub fn transfer_from(&mut self, from: Address, to: Address, token_id: U256) {
        let owner = self.owners.get(token_id);
        if owner != from {
            return;
        }
        let caller = self.vm().msg_sender();
        let approved = self.token_approvals.get(token_id);
        let is_operator = self.operator_approvals.getter(owner).getter(caller).get();
        if caller != owner && caller != approved && !is_operator {
            return;
        }
        self.token_approvals.setter(token_id).set(Address::ZERO);
        let from_bal = self.balances.get(from);
        if from_bal > U256::ZERO {
            self.balances.setter(from).set(from_bal - U256::from(1u64));
        }
        let to_bal = self.balances.get(to);
        self.balances.setter(to).set(to_bal + U256::from(1u64));
        self.owners.setter(token_id).set(to);

        let mut from_owned = self.owned_tokens.setter(from);
        let last_idx = from_owned.len().saturating_sub(1);
        let removed_idx: usize = self
            .owned_tokens_index
            .get(token_id)
            .try_into()
            .unwrap_or(0);
        if removed_idx != last_idx {
            if let Some(last) = from_owned.getter(last_idx).map(|v| v.get()) {
                if let Some(mut slot) = from_owned.setter(removed_idx) {
                    slot.set(last);
                }
                self.owned_tokens_index.setter(last).set(U256::from(removed_idx));
            }
        }
        from_owned.pop();

        let mut to_owned = self.owned_tokens.setter(to);
        let new_idx = U256::from(to_owned.len());
        self.owned_tokens_index.setter(token_id).set(new_idx);
        to_owned.push(token_id);
    }

    pub fn safe_transfer_from(&mut self, from: Address, to: Address, token_id: U256) {
        self.transfer_from(from, to, token_id);
    }
}
