//! # This module contains static functions to update the state of a DLC.

use std::ops::Deref;

use bitcoin::consensus::Encodable;
use bitcoin::hashes::Hash;
use bitcoin::hex::DisplayHex;
use bitcoin::{Amount, EcdsaSighashType, ScriptBuf, Sequence, TxIn, Txid};
use bitcoin::{Script, Transaction, Witness};
use dlc::util::get_sig_for_tx_input;
use dlc::{create_collateral_transaction, make_loan_escrow_after_codesep_script, make_loan_funding_redeemscript, DlcTransactions, PartyParams};
use dlc_messages::{AcceptLoanDlc, FundingInput, OfferLoanDlc};
use dlc_messages::{
    oracle_msgs::{OracleAnnouncement, OracleAttestation},
    AcceptDlc, FundingSignature, FundingSignatures, OfferDlc, SignDlc, WitnessElement,
};
// use lightning::util::message_signing::sign;
use secp256k1_zkp::{
    ecdsa::Signature, All, EcdsaAdaptorSignature, PublicKey, Secp256k1, SecretKey, Signing,
};

use crate::contract::accepted_contract::AcceptedLoanContract;
// use crate::contract::accepted_contract::AcceptedLoanContract;
use crate::contract::contract_input::LoanContractInput;
use crate::contract::offered_contract::{OfferedLoanContract};
use crate::{
    contract::{
        accepted_contract::AcceptedContract, contract_info::ContractInfo,
        contract_input::ContractInput, offered_contract::OfferedContract,
        signed_contract::SignedContract, AdaptorInfo,
    },
    conversion_utils::get_tx_input_infos,
    error::Error,
    Blockchain, ChannelId, ContractSigner, ContractSignerProvider, Time, Wallet,
};

/// Creates an [`OfferedContract`] and [`OfferDlc`] message from the provided
/// contract and oracle information.
pub fn offer_contract<W: Deref, B: Deref, T: Deref, X: ContractSigner, SP: Deref, C: Signing>(
    secp: &Secp256k1<C>,
    contract_input: &ContractInput,
    oracle_announcements: Vec<Vec<OracleAnnouncement>>,
    refund_delay: u32,
    counter_party: &PublicKey,
    wallet: &W,
    blockchain: &B,
    time: &T,
    signer_provider: &SP,
) -> Result<(OfferedContract, OfferDlc), Error>
where
    W::Target: Wallet,
    B::Target: Blockchain,
    T::Target: Time,
    SP::Target: ContractSignerProvider<Signer = X>,
{
    contract_input.validate()?;

    let id = crate::utils::get_new_temporary_id();
    let keys_id = signer_provider.derive_signer_key_id(true, id);
    let signer = signer_provider.derive_contract_signer(keys_id)?;
    let (party_params, funding_inputs_info) = crate::utils::get_party_params(
        secp,
        contract_input.offer_collateral,
        contract_input.fee_rate,
        wallet,
        &signer,
        blockchain,
    )?;

    let offered_contract = OfferedContract::new(
        id,
        contract_input,
        oracle_announcements,
        &party_params,
        &funding_inputs_info,
        counter_party,
        refund_delay,
        time.unix_time_now() as u32,
        keys_id,
    );

    let offer_msg: OfferDlc = (&offered_contract).into();

    Ok((offered_contract, offer_msg))
}

/// Creates an [`OfferedLoanContract`] and [`OfferLoanDlc`] message from the provided
/// contract and oracle information.
pub fn offer_loan_contract<W: Deref, B: Deref, T: Deref, X: ContractSigner, SP: Deref, C: Signing>(
    secp: &Secp256k1<C>,
    loan_contract_input: &LoanContractInput,
    oracle_announcements: Vec<Vec<OracleAnnouncement>>,
    refund_delay: u32,
    counter_party: &PublicKey,
    lender_preimage: u128,
    wallet: &W,
    blockchain: &B,
    time: &T,
    signer_provider: &SP,
) -> Result<(OfferedLoanContract, OfferLoanDlc), Error>
where
    W::Target: Wallet,
    B::Target: Blockchain,
    T::Target: Time,
    SP::Target: ContractSignerProvider<Signer = X>,
{
    loan_contract_input.validate()?;

    let id = crate::utils::get_new_temporary_id();
    let keys_id = signer_provider.derive_signer_key_id(true, id);
    let signer = signer_provider.derive_contract_signer(keys_id)?;
    let party_params = crate::utils::get_lender_party_params(
        secp,
        wallet,
        &signer,
    )?;

    let lender_preimage_bytes = lender_preimage.to_be_bytes();
    let lender_hash = bitcoin::hashes::sha256::Hash::hash(&lender_preimage_bytes).to_byte_array();

    let contract_input = ContractInput {
        offer_collateral: Amount::ZERO,
        accept_collateral: loan_contract_input.collateral,
        fee_rate: loan_contract_input.fee_rate,
        contract_infos: loan_contract_input.contract_infos.clone(),
    };

    let offered_contract = OfferedContract::new(
        id,
        &contract_input,
        oracle_announcements,
        &party_params,
        &Vec::new(),
        counter_party,
        refund_delay,
        time.unix_time_now() as u32,
        keys_id,
    );

    let offered_loan_contract = OfferedLoanContract {
        offered_contract: offered_contract.clone(),
        collateral_ratio: loan_contract_input.collateral_ratio,
        liquidation_ratio: loan_contract_input.liquidation_ratio,
        interest_rate: loan_contract_input.interest_rate,
        duration: loan_contract_input.duration,
        lender_hash: lender_hash,
    };

    let offer_msg: OfferLoanDlc = (&offered_loan_contract).into();

    Ok((offered_loan_contract, offer_msg))
}

/// Creates an [`AcceptedContract`] and produces
/// the accepting party's cet adaptor signatures.
pub fn accept_contract<W: Deref, X: ContractSigner, SP: Deref, B: Deref>(
    secp: &Secp256k1<All>,
    offered_contract: &OfferedContract,
    wallet: &W,
    signer_provider: &SP,
    blockchain: &B,
) -> Result<(AcceptedContract, AcceptDlc), Error>
where
    W::Target: Wallet,
    B::Target: Blockchain,
    SP::Target: ContractSignerProvider<Signer = X>,
{
    let total_collateral = offered_contract.total_collateral;

    let signer = signer_provider.derive_contract_signer(offered_contract.keys_id)?;
    let (accept_params, funding_inputs) = crate::utils::get_party_params(
        secp,
        total_collateral - offered_contract.offer_params.collateral,
        offered_contract.fee_rate_per_vb,
        wallet,
        &signer,
        blockchain,
    )?;

    let dlc_transactions = dlc::create_dlc_transactions(
        &offered_contract.offer_params,
        &accept_params,
        &offered_contract.contract_info[0].get_payouts(total_collateral)?,
        offered_contract.refund_locktime,
        offered_contract.fee_rate_per_vb,
        0,
        offered_contract.cet_locktime,
        offered_contract.fund_output_serial_id ,
    )?;

    let fund_output_value = dlc_transactions.get_fund_output().value;

    let (accepted_contract, adaptor_sigs) = accept_contract_internal(
        secp,
        offered_contract,
        &accept_params,
        &funding_inputs,
        &signer.get_secret_key()?,
        fund_output_value,
        None,
        &dlc_transactions,
    )?;

    let accept_msg: AcceptDlc = accepted_contract.get_accept_contract_msg(&adaptor_sigs);

    Ok((accepted_contract, accept_msg))
}

pub(crate) fn accept_contract_internal(
    secp: &Secp256k1<All>,
    offered_contract: &OfferedContract,
    accept_params: &PartyParams,
    funding_inputs: &[FundingInput],
    adaptor_secret_key: &SecretKey,
    input_value: Amount,
    input_script_pubkey: Option<&Script>,
    dlc_transactions: &DlcTransactions,
) -> Result<(AcceptedContract, Vec<EcdsaAdaptorSignature>), crate::Error> {
    let total_collateral = offered_contract.total_collateral;

    let input_script_pubkey =
        input_script_pubkey.unwrap_or_else(|| &dlc_transactions.funding_script_pubkey);

    let cet_input = dlc_transactions.cets[0].input[0].clone();

    let (adaptor_info, adaptor_sig) = offered_contract.contract_info[0].get_adaptor_info(
        secp,
        offered_contract.total_collateral,
        adaptor_secret_key,
        input_script_pubkey,
        input_value,
        &dlc_transactions.cets,
        0,
    )?;
    let mut adaptor_infos = vec![adaptor_info];
    let mut adaptor_sigs = adaptor_sig;

    let DlcTransactions {
        fund,
        cets,
        refund,
        funding_script_pubkey,
    } = dlc_transactions;

    let mut cets = cets.clone();

    for contract_info in offered_contract.contract_info.iter().skip(1) {
        let payouts = contract_info.get_payouts(total_collateral)?;

        let tmp_cets = dlc::create_cets(
            &cet_input,
            &offered_contract.offer_params.payout_script_pubkey,
            offered_contract.offer_params.payout_serial_id,
            &accept_params.payout_script_pubkey,
            accept_params.payout_serial_id,
            &payouts,
            0,
        );

        let (adaptor_info, adaptor_sig) = contract_info.get_adaptor_info(
            secp,
            offered_contract.total_collateral,
            adaptor_secret_key,
            input_script_pubkey,
            input_value,
            &tmp_cets,
            adaptor_sigs.len(),
        )?;

        cets.extend(tmp_cets);

        adaptor_infos.push(adaptor_info);
        adaptor_sigs.extend(adaptor_sig);
    }

    let refund_signature = dlc::util::get_raw_sig_for_tx_input(
        secp,
        refund,
        0,
        input_script_pubkey,
        input_value,
        adaptor_secret_key,
    )?;

    let dlc_transactions = DlcTransactions {
        fund: fund.clone(),
        cets,
        refund: refund.clone(),
        funding_script_pubkey: funding_script_pubkey.clone(),
    };

    let accepted_contract = AcceptedContract {
        offered_contract: offered_contract.clone(),
        adaptor_infos,
        // Drop own adaptor signatures as no point keeping them.
        adaptor_signatures: None,
        accept_params: accept_params.clone(),
        funding_inputs: funding_inputs.to_vec(),
        dlc_transactions,
        accept_refund_signature: refund_signature,
    };

    Ok((accepted_contract, adaptor_sigs))
}

/// Accepts a loan contract by creating an [`AcceptLoanDlc`] message.
pub fn accept_loan_contract<W: Deref, X: ContractSigner, SP: Deref, B: Deref>(
    secp: &Secp256k1<All>,
    offered_loan_contract: &OfferedLoanContract,
    escrow_txid: Txid,
    borrower_hash: [u8; 32],
    borrower_preimage_bytes: &[u8],
    wallet: &W,
    signer_provider: &SP,
    blockchain: &B,
) -> Result<(AcceptedLoanContract, AcceptLoanDlc), Error> 
// ) -> Result<AcceptLoanDlc, Error>
where
    W::Target: Wallet,
    B::Target: Blockchain,
    SP::Target: ContractSignerProvider<Signer = X>,
{
    let total_collateral = offered_loan_contract.offered_contract.total_collateral;
    let signer = signer_provider.derive_contract_signer(offered_loan_contract.offered_contract.keys_id)?;
    let borrower_pubkey = signer.get_public_key(secp)?;
    println!("Borrower pubkey: {}", borrower_pubkey);
    let lender_pubkey = offered_loan_contract.offered_contract.offer_params.fund_pubkey;
    
    let locktime = Sequence::from_hex("0x64004000").unwrap(); // 51200 seconds
    let funding_script_pubkey =  // TODO: Rename function to make loan escrow redeem script
        make_loan_funding_redeemscript(&borrower_pubkey, &lender_pubkey, locktime, &borrower_hash);
    let funding_script_pubkey_to_sign = 
        make_loan_escrow_after_codesep_script(&lender_pubkey, &borrower_hash);

    let escrow_input: TxIn = TxIn {
        previous_output: bitcoin::OutPoint {
            txid: escrow_txid,
            vout: 0,
        },
        script_sig: Script::new().into(),
        sequence: bitcoin::Sequence(0xFFFFFFFF),
        witness: Witness::default(),
    };

    let escrow_tx = blockchain.get_transaction(&escrow_txid).unwrap();
    let escrow_output_amount = escrow_tx.output[0].value;

    let mut writer = Vec::new();
    let _ = escrow_tx.consensus_encode(&mut writer);
    println!("raw escrow tx {}", writer.to_lower_hex_string());

    let (mut collateral_tx, collateral_script_pubkey) = create_collateral_transaction(&borrower_pubkey, &lender_pubkey, escrow_output_amount, escrow_input, offered_loan_contract.lender_hash).unwrap();
    let borrower_signature = get_sig_for_tx_input(
        secp,
        &collateral_tx,
        0,
        &funding_script_pubkey_to_sign,
        escrow_output_amount,
        EcdsaSighashType::All,
        &signer.get_secret_key().unwrap())
    .unwrap();

    collateral_tx.input[0].witness = Witness::from_slice(&[
        Vec::new(), // Placeholder for the other party's signature
        borrower_preimage_bytes.to_vec(),
        borrower_signature,
        funding_script_pubkey.to_bytes()
    ]);

    let (accept_params, funding_inputs) = crate::utils::get_party_params(
        secp,
        total_collateral,
        offered_loan_contract.offered_contract.fee_rate_per_vb,
        wallet,
        &signer,
        blockchain,
    )?;

    let collateral_tx_clone = collateral_tx.clone();
    
    let dlc_transactions = dlc::create_loan_expiration_dlc_transactions(
        &offered_loan_contract.offered_contract.offer_params,
        &accept_params,
        &offered_loan_contract.offered_contract.contract_info[0].get_payouts(total_collateral)?,
        offered_loan_contract.offered_contract.refund_locktime,
        offered_loan_contract.offered_contract.cet_locktime,
        collateral_tx,
        collateral_script_pubkey.clone()
    )?;

    let collateral_output_value = dlc_transactions.get_fund_output().value;

    let (accepted_contract, adaptor_sigs) = accept_loan_contract_internal(
        secp,
        offered_loan_contract,
        &accept_params,
        &funding_inputs,
        &signer.get_secret_key()?,
        collateral_output_value,
        None,
        &dlc_transactions,
        escrow_txid,
        borrower_hash,
        collateral_tx_clone,
    )?;

    // Create a dummy signature since we need a valid Signature type, not Option<Signature>
    // let dummy_refund_signature = secp256k1_zkp::ecdsa::Signature::from_compact(&[0; 64]).unwrap();
    
    // let accept_msg: AcceptLoanDlc = AcceptLoanDlc {
    //     protocol_version: 1,
    //     temporary_contract_id: offered_loan_contract.offered_contract.id,
    //     accept_collateral: total_collateral,
    //     funding_pubkey: offered_loan_contract.offered_contract.offer_params.fund_pubkey,
    //     payout_spk: offered_loan_contract.offered_contract.offer_params.payout_script_pubkey.clone(),
    //     payout_serial_id: offered_loan_contract.offered_contract.offer_params.payout_serial_id,
    //     funding_inputs: offered_loan_contract.offered_contract.funding_inputs.clone(),
    //     change_spk: offered_loan_contract.offered_contract.offer_params.change_script_pubkey.clone(),
    //     change_serial_id: offered_loan_contract.offered_contract.offer_params.change_serial_id,
    //     cet_adaptor_signatures: dlc_messages::CetAdaptorSignatures { ecdsa_adaptor_signatures: Vec::new() }, // This will be filled later with the adaptor signatures
    //     refund_signature: dummy_refund_signature, // Using a dummy signature instead of None
    //     negotiation_fields: None,
    //     escrow_txid,
    //     borrower_hash: borrower_hash,
    //     signed_escrow_spend_tx: collateral_tx_clone,
    //     escrow_amount: escrow_output_amount,
    //     escrow_spk: funding_script_pubkey_to_sign,
    //     // cet_adaptor_signatures: adaptor_sigs.into_iter().map(|x| x.into()).collect(),
    //     // accept_refund_signature: accepted_contract.accept_refund_signature,
    // };

    let accept_msg: AcceptLoanDlc = accepted_contract.get_accept_contract_msg(&adaptor_sigs, escrow_output_amount, &funding_script_pubkey_to_sign, &collateral_script_pubkey.clone());

    Ok((accepted_contract, accept_msg))
}

/// Internal function to accept a loan contract.
pub fn accept_loan_contract_internal(
    secp: &Secp256k1<All>,
    offered_loan_contract: &OfferedLoanContract,
    accept_params: &PartyParams,
    funding_inputs: &[FundingInput],
    adaptor_secret_key: &SecretKey,
    input_value: Amount,
    input_script_pubkey: Option<&Script>,
    dlc_transactions: &DlcTransactions,
    escrow_txid: Txid,
    borrower_hash: [u8; 32],
    signed_escrow_spend_tx: Transaction,
) -> Result<(AcceptedLoanContract, Vec<EcdsaAdaptorSignature>), crate::Error> {
    let total_collateral = offered_loan_contract.offered_contract.total_collateral;

    let input_script_pubkey =
        input_script_pubkey.unwrap_or_else(|| &dlc_transactions.funding_script_pubkey);

    let cet_input = dlc_transactions.cets[0].input[0].clone();
    let offered_contract = &offered_loan_contract.offered_contract;

    let (adaptor_info, adaptor_sig) = offered_contract.contract_info[0].get_adaptor_info(
        secp,
        offered_contract.total_collateral,
        adaptor_secret_key,
        input_script_pubkey,
        input_value,
        &dlc_transactions.cets,
        0,
    )?;
    let mut adaptor_infos = vec![adaptor_info];
    let mut adaptor_sigs = adaptor_sig;

    let DlcTransactions {
        fund,
        cets,
        refund,
        funding_script_pubkey,
    } = dlc_transactions;

    let mut cets = cets.clone();

    for contract_info in offered_contract.contract_info.iter().skip(1) {
        let payouts = contract_info.get_payouts(total_collateral)?;

        let tmp_cets = dlc::create_cets(
            &cet_input,
            &offered_contract.offer_params.payout_script_pubkey,
            offered_contract.offer_params.payout_serial_id,
            &accept_params.payout_script_pubkey,
            accept_params.payout_serial_id,
            &payouts,
            0,
        );

        let (adaptor_info, adaptor_sig) = contract_info.get_adaptor_info(
            secp,
            offered_contract.total_collateral,
            adaptor_secret_key,
            input_script_pubkey,
            input_value,
            &tmp_cets,
            adaptor_sigs.len(),
        )?;

        cets.extend(tmp_cets);

        adaptor_infos.push(adaptor_info);
        adaptor_sigs.extend(adaptor_sig);
    }

    let refund_signature = dlc::util::get_raw_sig_for_tx_input(
        secp,
        refund,
        0,
        input_script_pubkey,
        input_value,
        adaptor_secret_key,
    )?;

    let dlc_transactions = DlcTransactions {
        fund: fund.clone(),
        cets: cets.clone(),
        refund: refund.clone(),
        funding_script_pubkey: funding_script_pubkey.clone(),
    };

    let accepted_contract = AcceptedLoanContract {
        offered_loan_contract: offered_loan_contract.clone(),
        adaptor_infos,
        // Drop own adaptor signatures as no point keeping them.
        adaptor_signatures: None,
        accept_params: accept_params.clone(),
        funding_inputs: funding_inputs.to_vec(),
        dlc_transactions,
        accept_refund_signature: refund_signature,
        escrow_txid,
        borrower_hash,
        signed_escrow_spend_tx,
    };
    Ok((accepted_contract, adaptor_sigs))
}

/// Creates and sends the escrow transaction from the borrower side (accepting party).
pub fn send_escrow_transaction<W: Deref, X: ContractSigner, SP: Deref, B: Deref>(
    secp: &Secp256k1<All>,
    offered_loan_contract: &OfferedLoanContract,
    borrower_preimage: u128,
    wallet: &W,
    signer_provider: &SP,
    blockchain: &B,
) -> Result<Txid, Box<dyn std::error::Error>>
where
    W::Target: Wallet,
    B::Target: Blockchain,
    SP::Target: ContractSignerProvider<Signer = X>,
{
    let offered_contract = &offered_loan_contract.offered_contract;
    let total_collateral = offered_contract.total_collateral;

    let signer = signer_provider.derive_contract_signer(offered_contract.keys_id)?;
    let (accept_params, funding_inputs) = crate::utils::get_party_params(
        secp,
        total_collateral - offered_contract.offer_params.collateral,
        offered_contract.fee_rate_per_vb,
        wallet,
        &signer,
        blockchain,
    )?; 

    let (escrow_tx, _script_buf) = dlc::create_escrow_transaction(
        &offered_contract.offer_params,
        &accept_params,
        offered_contract.fee_rate_per_vb,
        offered_contract.refund_locktime,
        offered_contract.fund_output_serial_id,
        Amount::from_sat(300),
        borrower_preimage,
    )?;

    let signed_escrow_tx = wallet.sign_raw_transaction(&escrow_tx)?;
    blockchain.send_transaction(&signed_escrow_tx)?;
    let txid = escrow_tx.compute_txid();
    return Ok(txid);
}

/// Verifies the information of the accepting party [`Accept` message](dlc_messages::AcceptDlc),
/// creates a [`SignedContract`], and generates the offering party CET adaptor signatures.
pub fn verify_accepted_and_sign_contract<W: Deref, X: ContractSigner, SP: Deref>(
    secp: &Secp256k1<All>,
    offered_contract: &OfferedContract,
    accept_msg: &AcceptDlc,
    wallet: &W,
    signer_provider: &SP,
) -> Result<(SignedContract, SignDlc), Error>
where
    W::Target: Wallet,
    SP::Target: ContractSignerProvider<Signer = X>,
{
    let (tx_input_infos, input_amount) = get_tx_input_infos(&accept_msg.funding_inputs)?;

    let accept_params = PartyParams {
        fund_pubkey: accept_msg.funding_pubkey,
        change_script_pubkey: accept_msg.change_spk.clone(),
        change_serial_id: accept_msg.change_serial_id,
        payout_script_pubkey: accept_msg.payout_spk.clone(),
        payout_serial_id: accept_msg.payout_serial_id,
        inputs: tx_input_infos,
        input_amount,
        collateral: accept_msg.accept_collateral,
    };

    let cet_adaptor_signatures = accept_msg
        .cet_adaptor_signatures
        .ecdsa_adaptor_signatures
        .iter()
        .map(|x| x.signature)
        .collect::<Vec<_>>();

    let total_collateral = offered_contract.total_collateral;

    let dlc_transactions = dlc::create_dlc_transactions(
        &offered_contract.offer_params,
        &accept_params,
        &offered_contract.contract_info[0].get_payouts(total_collateral)?,
        offered_contract.refund_locktime,
        offered_contract.fee_rate_per_vb,
        0,
        offered_contract.cet_locktime,
        offered_contract.fund_output_serial_id,
    )?;
    let fund_output_value = dlc_transactions.get_fund_output().value;

    let signer = signer_provider.derive_contract_signer(offered_contract.keys_id)?;
    let (signed_contract, adaptor_sigs) = verify_accepted_and_sign_contract_internal(
        secp,
        offered_contract,
        &accept_params,
        &accept_msg.funding_inputs,
        &accept_msg.refund_signature,
        &cet_adaptor_signatures,
        fund_output_value,
        wallet,
        &signer,
        None,
        None,
        &dlc_transactions,
        None,
    )?;

    let signed_msg: SignDlc = signed_contract.get_sign_dlc(adaptor_sigs);

    Ok((signed_contract, signed_msg))
}

/// Verifies the information of the accepting party [`Accept` message](dlc_messages::AcceptDlc),
/// creates a [`SignedContract`], and generates the offering party CET adaptor signatures.
pub fn verify_accepted_and_sign_loan_contract<W: Deref, X: ContractSigner, SP: Deref>(
    secp: &Secp256k1<All>,
    offered_contract: &OfferedContract,
    accept_msg: &AcceptDlc,
    collateral_tx: Transaction,
    collateral_script_pubkey: ScriptBuf,
    wallet: &W,
    signer_provider: &SP,
) -> Result<(SignedContract, SignDlc), Error>
where
    W::Target: Wallet,
    SP::Target: ContractSignerProvider<Signer = X>,
{
    let (tx_input_infos, input_amount) = get_tx_input_infos(&accept_msg.funding_inputs)?;

    let accept_params = PartyParams {
        fund_pubkey: accept_msg.funding_pubkey,
        change_script_pubkey: accept_msg.change_spk.clone(),
        change_serial_id: accept_msg.change_serial_id,
        payout_script_pubkey: accept_msg.payout_spk.clone(),
        payout_serial_id: accept_msg.payout_serial_id,
        inputs: tx_input_infos,
        input_amount,
        collateral: accept_msg.accept_collateral,
    };

    let cet_adaptor_signatures = accept_msg
        .cet_adaptor_signatures
        .ecdsa_adaptor_signatures
        .iter()
        .map(|x| x.signature)
        .collect::<Vec<_>>();

    let total_collateral = offered_contract.total_collateral;

    let dlc_transactions = dlc::create_loan_expiration_dlc_transactions(
        &offered_contract.offer_params,
        &accept_params,
        &offered_contract.contract_info[0].get_payouts(total_collateral)?,
        offered_contract.refund_locktime,
        offered_contract.cet_locktime,
        collateral_tx,
        collateral_script_pubkey
    )?;

    let fund_output_value = dlc_transactions.get_fund_output().value;

    let signer = signer_provider.derive_contract_signer(offered_contract.keys_id)?;
    let (signed_contract, adaptor_sigs) = verify_accepted_and_sign_contract_internal(
        secp,
        offered_contract,
        &accept_params,
        &accept_msg.funding_inputs,
        &accept_msg.refund_signature,
        &cet_adaptor_signatures,
        fund_output_value,
        wallet,
        &signer,
        None,
        None,
        &dlc_transactions,
        None,
    )?;

    let signed_msg: SignDlc = signed_contract.get_sign_dlc(adaptor_sigs);

    Ok((signed_contract, signed_msg))
}

// fn populate_psbt(psbt: &mut Psbt, all_funding_inputs: &[&FundingInput]) -> Result<(), Error> {
//     // add witness utxo to fund_psbt for all inputs
//     for (input_index, x) in all_funding_inputs.iter().enumerate() {
//         let tx = Transaction::consensus_decode(&mut x.prev_tx.as_slice()).map_err(|_| {
//             Error::InvalidParameters(
//                 "Could not decode funding input previous tx parameter".to_string(),
//             )
//         })?;
//         let vout = x.prev_tx_vout;
//         let tx_out = tx.output.get(vout as usize).ok_or_else(|| {
//             Error::InvalidParameters(format!("Previous tx output not found at index {}", vout))
//         })?;

//         psbt.inputs[input_index].witness_utxo = Some(tx_out.clone());
//         psbt.inputs[input_index].redeem_script = Some(x.redeem_script.clone());
//     }

//     Ok(())
// }

pub(crate) fn verify_accepted_and_sign_contract_internal<W: Deref, X: ContractSigner>(
    secp: &Secp256k1<All>,
    offered_contract: &OfferedContract,
    accept_params: &PartyParams,
    funding_inputs_info: &[FundingInput],
    refund_signature: &Signature,
    cet_adaptor_signatures: &[EcdsaAdaptorSignature],
    input_value: Amount,
    wallet: &W,
    signer: &X,
    input_script_pubkey: Option<&Script>,
    counter_adaptor_pk: Option<PublicKey>,
    dlc_transactions: &DlcTransactions,
    channel_id: Option<ChannelId>,
) -> Result<(SignedContract, Vec<EcdsaAdaptorSignature>), Error>
where
    W::Target: Wallet,
{
    let DlcTransactions {
        fund,
        cets,
        refund,
        funding_script_pubkey,
    } = dlc_transactions;

    // let mut fund_psbt = Psbt::from_unsigned_tx(fund.clone())
    //     .map_err(|_| Error::InvalidState("Tried to create PSBT from signed tx".to_string()))?;
    let mut cets = cets.clone();

    let input_script_pubkey = input_script_pubkey.unwrap_or_else(|| funding_script_pubkey);
    let counter_adaptor_pk = counter_adaptor_pk.unwrap_or(accept_params.fund_pubkey);

    dlc::verify_tx_input_sig(
        secp,
        refund_signature,
        refund,
        0,
        input_script_pubkey,
        input_value,
        &counter_adaptor_pk,
    )?;

    let (adaptor_info, mut adaptor_index) = offered_contract.contract_info[0]
        .verify_and_get_adaptor_info(
            secp,
            offered_contract.total_collateral,
            &counter_adaptor_pk,
            input_script_pubkey,
            input_value,
            &cets,
            cet_adaptor_signatures,
            0,
        )?;

    let mut adaptor_infos = vec![adaptor_info];

    let cet_input = cets[0].input[0].clone();

    let total_collateral = offered_contract.offer_params.collateral + accept_params.collateral;

    for contract_info in offered_contract.contract_info.iter().skip(1) {
        let payouts = contract_info.get_payouts(total_collateral)?;

        let tmp_cets = dlc::create_cets(
            &cet_input,
            &offered_contract.offer_params.payout_script_pubkey,
            offered_contract.offer_params.payout_serial_id,
            &accept_params.payout_script_pubkey,
            accept_params.payout_serial_id,
            &payouts,
            0,
        );

        let (adaptor_info, tmp_adaptor_index) = contract_info.verify_and_get_adaptor_info(
            secp,
            offered_contract.total_collateral,
            &accept_params.fund_pubkey,
            funding_script_pubkey,
            input_value,
            &tmp_cets,
            cet_adaptor_signatures,
            adaptor_index,
        )?;

        adaptor_index = tmp_adaptor_index;

        cets.extend(tmp_cets);

        adaptor_infos.push(adaptor_info);
    }

    let mut own_signatures: Vec<EcdsaAdaptorSignature> = Vec::new();

    for (contract_info, adaptor_info) in offered_contract
        .contract_info
        .iter()
        .zip(adaptor_infos.iter())
    {
        let sigs = contract_info.get_adaptor_signatures(
            secp,
            adaptor_info,
            &signer,
            input_script_pubkey,
            input_value,
            &cets,
        )?;
        own_signatures.extend(sigs);
    }

    // // get all funding inputs
    // let mut all_funding_inputs = offered_contract
    //     .funding_inputs
    //     .iter()
    //     .chain(funding_inputs_info.iter())
    //     .collect::<Vec<_>>();
    // // sort by serial id
    // all_funding_inputs.sort_by_key(|x| x.input_serial_id);

    // populate_psbt(&mut fund_psbt, &all_funding_inputs)?;

    // // Vec<Witness>
    // let witnesses: Vec<Witness> = offered_contract
    //     .funding_inputs
    //     .iter()
    //     .map(|x| {
    //         let input_index = all_funding_inputs
    //             .iter()
    //             .position(|y| y == &x)
    //             .ok_or_else(|| {
    //                 Error::InvalidState(format!(
    //                     "Could not find input for serial id {}",
    //                     x.input_serial_id
    //                 ))
    //             })?;

    //         wallet.sign_psbt_input(&mut fund_psbt, input_index)?;

    //         let witness = fund_psbt.inputs[input_index]
    //             .final_script_witness
    //             .clone()
    //             .ok_or(Error::InvalidParameters(
    //                 "No witness from signing psbt input".to_string(),
    //             ))?;

    //         Ok(witness)
    //     })
    //     .collect::<Result<Vec<_>, Error>>()?;

    // let funding_signatures: Vec<FundingSignature> = witnesses
    //     .into_iter()
    //     .map(|witness| {
    //         let witness_elements = witness
    //             .iter()
    //             .map(|z| WitnessElement {
    //                 witness: z.to_vec(),
    //             })
    //             .collect();
    //         Ok(FundingSignature { witness_elements })
    //     })
    //     .collect::<Result<Vec<_>, Error>>()?;

    let offer_refund_signature = dlc::util::get_raw_sig_for_tx_input(
        secp,
        refund,
        0,
        input_script_pubkey,
        input_value,
        &signer.get_secret_key()?,
    )?;

    let dlc_transactions = DlcTransactions {
        fund: fund.clone(),
        cets,
        refund: refund.clone(),
        funding_script_pubkey: funding_script_pubkey.clone(),
    };

    let accepted_contract = AcceptedContract {
        offered_contract: offered_contract.clone(),
        accept_params: accept_params.clone(),
        funding_inputs: funding_inputs_info.to_vec(),
        adaptor_infos,
        adaptor_signatures: Some(cet_adaptor_signatures.to_vec()),
        accept_refund_signature: *refund_signature,
        dlc_transactions,
    };

    let dummy_funding_signatures = vec![FundingSignature {
        witness_elements: vec![WitnessElement {
            witness: vec![0; 0], // Placeholder for the funding signature
        }],
    }];

    let signed_contract = SignedContract {
        accepted_contract,
        adaptor_signatures: None,
        offer_refund_signature,
        funding_signatures: FundingSignatures { funding_signatures: dummy_funding_signatures },
        channel_id,
    };

    Ok((signed_contract, own_signatures))
}

/// Verifies the information from the offer party [`Sign` message](dlc_messages::SignDlc),
/// creates the accepting party's [`SignedContract`] and returns it along with the
/// signed fund transaction.
pub fn verify_signed_contract<W: Deref>(
    secp: &Secp256k1<All>,
    accepted_contract: &AcceptedContract,
    sign_msg: &SignDlc,
    wallet: &W,
) -> Result<(SignedContract, Transaction), Error>
where
    W::Target: Wallet,
{
    let cet_adaptor_signatures: Vec<_> = (&sign_msg.cet_adaptor_signatures).into();
    verify_signed_contract_internal(
        secp,
        accepted_contract,
        &sign_msg.refund_signature,
        &cet_adaptor_signatures,
        &sign_msg.funding_signatures,
        accepted_contract.dlc_transactions.get_fund_output().value,
        None,
        None,
        wallet,
        None,
    )
}

pub(crate) fn verify_signed_contract_internal<W: Deref>(
    secp: &Secp256k1<All>,
    accepted_contract: &AcceptedContract,
    refund_signature: &Signature,
    cet_adaptor_signatures: &[EcdsaAdaptorSignature],
    funding_signatures: &FundingSignatures,
    input_value: Amount,
    input_script_pubkey: Option<&Script>,
    counter_adaptor_pk: Option<PublicKey>,
    wallet: &W,
    channel_id: Option<ChannelId>,
) -> Result<(SignedContract, Transaction), Error>
where
    W::Target: Wallet,
{
    let offered_contract = &accepted_contract.offered_contract;
    let input_script_pubkey = input_script_pubkey
        .unwrap_or_else(|| &accepted_contract.dlc_transactions.funding_script_pubkey);
    let counter_adaptor_pk =
        counter_adaptor_pk.unwrap_or(accepted_contract.offered_contract.offer_params.fund_pubkey);

    dlc::verify_tx_input_sig(
        secp,
        refund_signature,
        &accepted_contract.dlc_transactions.refund,
        0,
        input_script_pubkey,
        input_value,
        &counter_adaptor_pk,
    )?;

    let mut adaptor_sig_start = 0;

    for (adaptor_info, contract_info) in accepted_contract
        .adaptor_infos
        .iter()
        .zip(offered_contract.contract_info.iter())
    {
        adaptor_sig_start = contract_info.verify_adaptor_info(
            secp,
            &counter_adaptor_pk,
            input_script_pubkey,
            input_value,
            &accepted_contract.dlc_transactions.cets,
            cet_adaptor_signatures,
            adaptor_sig_start,
            adaptor_info,
        )?;
    }

    let fund_tx: &Transaction = &accepted_contract.dlc_transactions.fund;
    // let mut fund_psbt = Psbt::from_unsigned_tx(fund_tx.clone())
    //     .map_err(|_| Error::InvalidState("Tried to create PSBT from signed tx".to_string()))?;

    // // get all funding inputs
    // let mut all_funding_inputs = offered_contract
    //     .funding_inputs
    //     .iter()
    //     .chain(accepted_contract.funding_inputs.iter())
    //     .collect::<Vec<_>>();
    // // sort by serial id
    // all_funding_inputs.sort_by_key(|x| x.input_serial_id);

    // populate_psbt(&mut fund_psbt, &all_funding_inputs)?;

    // for (funding_input, funding_signatures) in offered_contract
    //     .funding_inputs
    //     .iter()
    //     .zip(funding_signatures.funding_signatures.iter())
    // {
    //     let input_index = all_funding_inputs
    //         .iter()
    //         .position(|x| x == &funding_input)
    //         .ok_or_else(|| {
    //             Error::InvalidState(format!(
    //                 "Could not find input for serial id {}",
    //                 funding_input.input_serial_id
    //             ))
    //         })?;

    //     fund_psbt.inputs[input_index].final_script_witness = Some(Witness::from_slice(
    //         &funding_signatures
    //             .witness_elements
    //             .iter()
    //             .map(|x| x.witness.clone())
    //             .collect::<Vec<_>>(),
    //     ));
    // }

    // for funding_input in &accepted_contract.funding_inputs {
    //     let input_index = all_funding_inputs
    //         .iter()
    //         .position(|x| x == &funding_input)
    //         .ok_or_else(|| {
    //             Error::InvalidState(format!(
    //                 "Could not find input for serial id {}",
    //                 funding_input.input_serial_id
    //             ))
    //         })?;

    //     wallet.sign_psbt_input(&mut fund_psbt, input_index)?;
    // }

    let dummy_funding_signatures = vec![FundingSignature {
        witness_elements: vec![WitnessElement {
            witness: vec![0; 0], // Placeholder for the funding signature
        }],
    }];

    let signed_contract = SignedContract {
        accepted_contract: accepted_contract.clone(),
        adaptor_signatures: Some(cet_adaptor_signatures.to_vec()),
        offer_refund_signature: *refund_signature,
        funding_signatures: funding_signatures.clone(),
        channel_id,
    };

    Ok((signed_contract, fund_tx.clone()))
}

/// Signs and return the CET that can be used to close the given contract.
pub fn get_signed_cet<C: Signing, S: Deref>(
    secp: &Secp256k1<C>,
    contract: &SignedContract,
    contract_info: &ContractInfo,
    adaptor_info: &AdaptorInfo,
    attestations: &[(usize, OracleAttestation)],
    signer: S,
) -> Result<Transaction, Error>
where
    S::Target: ContractSigner,
{
    let (range_info, sigs) =
        crate::utils::get_range_info_and_oracle_sigs(contract_info, adaptor_info, attestations)?;
    let mut cet = contract.accepted_contract.dlc_transactions.cets[range_info.cet_index].clone();
    let offered_contract = &contract.accepted_contract.offered_contract;

    let (adaptor_sigs, other_pubkey) = if offered_contract.is_offer_party {
        (
            contract
                .accepted_contract
                .adaptor_signatures
                .as_ref()
                .unwrap(),
            &contract.accepted_contract.accept_params.fund_pubkey,
        )
    } else {
        (
            contract.adaptor_signatures.as_ref().unwrap(),
            &offered_contract.offer_params.fund_pubkey,
        )
    };

    let funding_sk = signer.get_secret_key()?;

    dlc::sign_cet(
        secp,
        &mut cet,
        &adaptor_sigs[range_info.adaptor_index],
        &sigs,
        &funding_sk,
        other_pubkey,
        &contract
            .accepted_contract
            .dlc_transactions
            .funding_script_pubkey,
        contract
            .accepted_contract
            .dlc_transactions
            .get_fund_output()
            .value,
    )?;

    Ok(cet)
}

/// Signs and return the refund transaction to refund the contract.
pub fn get_signed_refund<C: Signing, S: Deref>(
    secp: &Secp256k1<C>,
    contract: &SignedContract,
    signer: S,
) -> Result<Transaction, Error>
where
    S::Target: ContractSigner,
{
    let accepted_contract = &contract.accepted_contract;
    let offered_contract = &accepted_contract.offered_contract;
    let funding_script_pubkey = &accepted_contract.dlc_transactions.funding_script_pubkey;
    let fund_output_value = accepted_contract.dlc_transactions.get_fund_output().value;
    let (other_fund_pubkey, other_sig) = if offered_contract.is_offer_party {
        (
            &accepted_contract.accept_params.fund_pubkey,
            &accepted_contract.accept_refund_signature,
        )
    } else {
        (
            &offered_contract.offer_params.fund_pubkey,
            &contract.offer_refund_signature,
        )
    };

    let fund_priv_key = signer.get_secret_key()?;
    let mut refund = accepted_contract.dlc_transactions.refund.clone();
    dlc::util::sign_multi_sig_input(
        secp,
        &mut refund,
        other_sig,
        other_fund_pubkey,
        &fund_priv_key,
        funding_script_pubkey,
        fund_output_value,
        0,
    )?;
    Ok(refund)
}

#[cfg(test)]
mod tests {
    use std::rc::Rc;

    use bitcoin::Amount;
    use mocks::dlc_manager::contract::offered_contract::OfferedContract;
    use secp256k1_zkp::PublicKey;

    #[test]
    fn accept_contract_test() {
        let offer_dlc =
            serde_json::from_str(include_str!("../test_inputs/offer_contract.json")).unwrap();
        let dummy_pubkey: PublicKey =
            "02e6642fd69bd211f93f7f1f36ca51a26a5290eb2dd1b0d8279a87bb0d480c8443"
                .parse()
                .unwrap();
        let offered_contract =
            OfferedContract::try_from_offer_dlc(&offer_dlc, dummy_pubkey, [0; 32]).unwrap();
        let blockchain = Rc::new(mocks::mock_blockchain::MockBlockchain::new());
        let fee_rate: u64 = offered_contract.fee_rate_per_vb;
        let utxo_value = offered_contract.total_collateral
            - offered_contract.offer_params.collateral
            + crate::utils::get_half_common_fee(fee_rate).unwrap();
        let wallet = Rc::new(mocks::mock_wallet::MockWallet::new(
            &blockchain,
            &[utxo_value, Amount::from_sat(10000)],
        ));

        mocks::dlc_manager::contract_updater::accept_contract(
            secp256k1_zkp::SECP256K1,
            &offered_contract,
            &wallet,
            &wallet,
            &blockchain,
        )
        .expect("Not to fail");
    }
}
