//! # AcceptedContract
use crate::Error;

use super::offered_contract::{OfferedContract, OfferedLoanContract};
use super::AdaptorInfo;
use bitcoin::{Amount, SignedAmount, Transaction, Txid};
use dlc::{DlcTransactions, PartyParams};
use dlc_messages::{AcceptDlc, AcceptLoanDlc, FundingInput};
use secp256k1_zkp::ecdsa::Signature;
use secp256k1_zkp::EcdsaAdaptorSignature;

use std::fmt::Write as _;

/// An AcceptedContract represents a contract in the accepted state.
#[derive(Clone)]
pub struct AcceptedContract {
    /// The offered contract that was accepted.
    pub offered_contract: OfferedContract,
    /// The parameters of the accepting party.
    pub accept_params: PartyParams,
    /// The funding inputs provided by the accepting party.
    pub funding_inputs: Vec<FundingInput>,
    /// The adaptor information for the contract storing information about
    /// the relation between adaptor signatures and outcomes.
    pub adaptor_infos: Vec<AdaptorInfo>,
    /// The adaptor signatures of the accepting party. Note that the accepting
    /// party does not keep them thus an option is used.
    pub adaptor_signatures: Option<Vec<EcdsaAdaptorSignature>>,
    /// The signature for the refund transaction from the accepting party.
    pub accept_refund_signature: Signature,
    /// The bitcoin set of bitcoin transactions for the contract.
    pub dlc_transactions: DlcTransactions,
}

/// An AcceptedLoanContract represents a loan contract in the accepted state.
#[derive(Clone)]
pub struct AcceptedLoanContract {
        /// The offered loan contract that was accepted.
        pub offered_loan_contract: OfferedLoanContract,
        /// The parameters of the accepting party.
        pub accept_params: PartyParams,
        /// The funding inputs provided by the accepting party.
        pub funding_inputs: Vec<FundingInput>,
        /// The adaptor information for the contract storing information about
        /// the relation between adaptor signatures and outcomes.
        pub adaptor_infos: Vec<AdaptorInfo>,
        /// The adaptor signatures of the accepting party. Note that the accepting
        /// party does not keep them thus an option is used.
        pub adaptor_signatures: Option<Vec<EcdsaAdaptorSignature>>,
        /// The signature for the refund transaction from the accepting party.
        pub accept_refund_signature: Signature,
        /// The bitcoin set of bitcoin transactions for the contract.
        pub dlc_transactions: DlcTransactions,
        /// Txid of the escrow transaction
        pub escrow_txid: Txid,
        /// Borrower's hashvalue
        pub borrower_hash: [u8; 32],
        /// Signed tx that spends the escrow transaction for collateral transaction
        pub signed_escrow_spend_tx: Transaction,
}

impl AcceptedContract {
    /// Returns the contract id for the contract computed as specified here:
    /// <https://github.com/discreetlogcontracts/dlcspecs/blob/master/Protocol.md#requirements-2>
    pub fn get_contract_id(&self) -> [u8; 32] {
        crate::utils::compute_id(
            self.dlc_transactions.fund.compute_txid(),
            self.dlc_transactions.get_fund_output_index() as u16,
            &self.offered_contract.id,
        )
    }

    /// Utility function to get the contract id as a string.
    pub fn get_contract_id_string(&self) -> String {
        let mut string_id = String::with_capacity(32 * 2 + 2);
        string_id.push_str("0x");
        let id = self.get_contract_id();
        for i in &id {
            write!(string_id, "{:02x}", i).unwrap();
        }

        string_id
    }

    pub(crate) fn get_accept_contract_msg(
        &self,
        ecdsa_adaptor_signatures: &[EcdsaAdaptorSignature],
    ) -> AcceptDlc {
        AcceptDlc {
            protocol_version: crate::conversion_utils::PROTOCOL_VERSION,
            temporary_contract_id: self.offered_contract.id,
            accept_collateral: self.accept_params.collateral,
            funding_pubkey: self.accept_params.fund_pubkey,
            payout_spk: self.accept_params.payout_script_pubkey.clone(),
            payout_serial_id: self.accept_params.payout_serial_id,
            funding_inputs: self.funding_inputs.clone(),
            change_spk: self.accept_params.change_script_pubkey.clone(),
            change_serial_id: self.accept_params.change_serial_id,
            cet_adaptor_signatures: ecdsa_adaptor_signatures.into(),
            refund_signature: self.accept_refund_signature,
            negotiation_fields: None,
        }
    }

    /// Compute the profit and loss for this contract and an assciated cet index
    pub fn compute_pnl(&self, cet: &Transaction) -> Result<SignedAmount, Error> {
        let offer = &self.offered_contract;
        let party_params = if offer.is_offer_party {
            &offer.offer_params
        } else {
            &self.accept_params
        };
        let collateral = party_params.collateral;
        let v0_witness_payout_script = &party_params.payout_script_pubkey;
        let final_payout = cet
            .output
            .iter()
            .find_map(|x| {
                if &x.script_pubkey == v0_witness_payout_script {
                    Some(x.value)
                } else {
                    None
                }
            })
            .unwrap_or(Amount::ZERO);
        Ok(final_payout.to_signed().map_err(|_| Error::OutOfRange)?
            - collateral.to_signed().map_err(|_| Error::OutOfRange)?)
    }
}

impl AcceptedLoanContract {
    /// Returns the contract id
    pub fn get_contract_id(&self) -> [u8; 32] {
        crate::utils::compute_id(
            self.dlc_transactions.fund.compute_txid(),
            self.dlc_transactions.get_fund_output_index() as u16,
            &self.offered_loan_contract.offered_contract.id,
        )
    }
    /// Utility function to get the contract id as a string.
    pub fn get_contract_id_string(&self) -> String {
        let mut string_id = String::with_capacity(32 * 2 + 2);
        string_id.push_str("0x");
        let id = self.get_contract_id();
        for i in &id {
            write!(string_id, "{:02x}", i).unwrap();
        }

        string_id
    }

    pub(crate) fn get_accept_contract_msg(
        &self,
        ecdsa_adaptor_signatures: &[EcdsaAdaptorSignature],
        escrow_amount: Amount,
        escrow_spk: &bitcoin::Script,
        collateral_spk: &bitcoin::Script,
    ) -> AcceptLoanDlc {
        AcceptLoanDlc {
            protocol_version: crate::conversion_utils::PROTOCOL_VERSION,
            temporary_contract_id: self.offered_loan_contract.offered_contract.id,
            accept_collateral: self.accept_params.collateral,
            funding_pubkey: self.accept_params.fund_pubkey,
            payout_spk: self.accept_params.payout_script_pubkey.clone(),
            payout_serial_id: self.accept_params.payout_serial_id,
            funding_inputs: self.funding_inputs.clone(),
            change_spk: self.accept_params.change_script_pubkey.clone(),
            change_serial_id: self.accept_params.change_serial_id,
            cet_adaptor_signatures: ecdsa_adaptor_signatures.into(),
            refund_signature: self.accept_refund_signature,
            negotiation_fields: None,
            escrow_txid: self.escrow_txid, 
            borrower_hash: self.borrower_hash,
            signed_escrow_spend_tx: self.signed_escrow_spend_tx.clone(),
            escrow_amount,
            escrow_spk: escrow_spk.into(),
            collateral_spk: collateral_spk.into(),
        }
    }

    /// Compute the profit and loss for this contract and an assciated cet index
    pub fn compute_pnl(&self, cet: &Transaction) -> Result<SignedAmount, Error> {
        let offer = &self.offered_loan_contract;
        let party_params = if offer.offered_contract.is_offer_party {
            &offer.offered_contract.offer_params
        } else {
            &self.accept_params
        };
        let collateral = party_params.collateral;
        let v0_witness_payout_script = &party_params.payout_script_pubkey;
        let final_payout = cet
            .output
            .iter()
            .find_map(|x| {
                if &x.script_pubkey == v0_witness_payout_script {
                    Some(x.value)
                } else {
                    None
                }
            })
            .unwrap_or(Amount::ZERO);
        Ok(final_payout.to_signed().map_err(|_| Error::OutOfRange)?
            - collateral.to_signed().map_err(|_| Error::OutOfRange)?)
    }
    /// Convert the AcceptedLoanContract to an AcceptedContract
    pub fn to_accepted_contract(self) -> AcceptedContract {
        AcceptedContract {
            offered_contract: self.offered_loan_contract.offered_contract,
            accept_params: self.accept_params,
            funding_inputs: self.funding_inputs,
            adaptor_infos: self.adaptor_infos,
            adaptor_signatures: self.adaptor_signatures,
            accept_refund_signature: self.accept_refund_signature,
            dlc_transactions: self.dlc_transactions,
        }
    }
}
    

#[cfg(test)]
mod tests {
    use lightning::io::Cursor;

    use lightning::util::ser::Readable;

    use super::*;

    #[test]
    fn pnl_compute_test() {
        let buf = include_bytes!("../../../dlc-sled-storage-provider/test_files/Accepted");
        let accepted_contract: AcceptedContract = Readable::read(&mut Cursor::new(&buf)).unwrap();
        let cets = &accepted_contract.dlc_transactions.cets;
        assert_eq!(
            accepted_contract.compute_pnl(&cets[0]).unwrap(),
            SignedAmount::from_sat(90000000)
        );
        assert_eq!(
            accepted_contract
                .compute_pnl(&cets[cets.len() - 1])
                .unwrap(),
            SignedAmount::from_sat(-11000000)
        );
    }
}
