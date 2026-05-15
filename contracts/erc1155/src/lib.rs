// Minimal Stylus ERC-1155 fixture. Exists so M3's codegen has a contract
// with mixed read / write methods, dynamic arrays, and bytes parameters.

#![cfg_attr(not(any(feature = "export-abi", test)), no_main)]
extern crate alloc;

use alloc::{string::String, vec::Vec};
use stylus_sdk::{
    abi::Bytes,
    alloy_primitives::{Address, U256},
    prelude::*,
    storage::{StorageBool, StorageMap, StorageString, StorageU256},
};

#[storage]
#[entrypoint]
pub struct Erc1155 {
    balances: StorageMap<U256, StorageMap<Address, StorageU256>>,
    operator_approvals: StorageMap<Address, StorageMap<Address, StorageBool>>,
    uri_: StorageString,
}

#[public]
impl Erc1155 {
    pub fn uri(&self, _id: U256) -> String {
        self.uri_.get_string()
    }

    pub fn balance_of(&self, account: Address, id: U256) -> U256 {
        self.balances.getter(id).getter(account).get()
    }

    pub fn balance_of_batch(
        &self,
        accounts: Vec<Address>,
        ids: Vec<U256>,
    ) -> Vec<U256> {
        let mut out = Vec::with_capacity(accounts.len());
        let n = core::cmp::min(accounts.len(), ids.len());
        for i in 0..n {
            out.push(self.balances.getter(ids[i]).getter(accounts[i]).get());
        }
        out
    }

    pub fn is_approved_for_all(&self, account: Address, operator: Address) -> bool {
        self.operator_approvals.getter(account).getter(operator).get()
    }

    pub fn set_approval_for_all(&mut self, operator: Address, approved: bool) {
        let caller = self.vm().msg_sender();
        self.operator_approvals
            .setter(caller)
            .setter(operator)
            .set(approved);
    }

    pub fn safe_transfer_from(
        &mut self,
        from: Address,
        to: Address,
        id: U256,
        amount: U256,
        _data: Bytes,
    ) {
        let caller = self.vm().msg_sender();
        let is_operator = self
            .operator_approvals
            .getter(from)
            .getter(caller)
            .get();
        if caller != from && !is_operator {
            return;
        }
        let from_bal = self.balances.getter(id).getter(from).get();
        if from_bal < amount {
            return;
        }
        self.balances
            .setter(id)
            .setter(from)
            .set(from_bal - amount);
        let to_bal = self.balances.getter(id).getter(to).get();
        self.balances.setter(id).setter(to).set(to_bal + amount);
    }

    pub fn safe_batch_transfer_from(
        &mut self,
        from: Address,
        to: Address,
        ids: Vec<U256>,
        amounts: Vec<U256>,
        _data: Bytes,
    ) {
        let caller = self.vm().msg_sender();
        let is_operator = self
            .operator_approvals
            .getter(from)
            .getter(caller)
            .get();
        if caller != from && !is_operator {
            return;
        }
        let n = core::cmp::min(ids.len(), amounts.len());
        for i in 0..n {
            let id = ids[i];
            let amount = amounts[i];
            let from_bal = self.balances.getter(id).getter(from).get();
            if from_bal < amount {
                continue;
            }
            self.balances
                .setter(id)
                .setter(from)
                .set(from_bal - amount);
            let to_bal = self.balances.getter(id).getter(to).get();
            self.balances.setter(id).setter(to).set(to_bal + amount);
        }
    }

    pub fn mint(&mut self, to: Address, id: U256, amount: U256) {
        let bal = self.balances.getter(id).getter(to).get();
        self.balances.setter(id).setter(to).set(bal + amount);
    }
}
