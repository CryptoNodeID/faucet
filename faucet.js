import express from 'express';
import * as path from 'path'

import { Wallet } from '@ethersproject/wallet'
import { pathToString } from '@cosmjs/crypto';

import { ethers } from 'ethers'
import { bech32 } from 'bech32';

import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { SigningStargateClient } from "@cosmjs/stargate";

import conf from './config.js'
import { FrequencyChecker } from './checker.js';

// load config
console.log("loaded config: ", conf)
const app = express()
app.set("view engine", "ejs");
const checker = new FrequencyChecker(conf)

app.get('/', (req, res) => {
  res.render('index', conf);
})

app.get('/config.json', async (req, res) => {
  const sample = {}
  for(let i =0; i < conf.blockchains.length; i++) {
    const chainConf = conf.blockchains[i]
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(chainConf.sender.mnemonic, chainConf.sender.option);
    const [firstAccount] = await wallet.getAccounts();
    sample[chainConf.name] = firstAccount.address

    const wallet2 = Wallet.fromMnemonic(chainConf.sender.mnemonic, pathToString(chainConf.sender.option.hdPaths[0]));
    console.log('address:', firstAccount.address, wallet2.address)
  }

  const project = conf.project
  project.sample = sample
  project.blockchains = conf.blockchains.map(x => x.name)
  res.send(project);
})

app.get('/:chain/balance', async (req, res) => {
  const { chain }= req.params

  let balance = {}
  let address = null

  try{
    const chainConf = conf.blockchains.find(x => x.name === chain)
    if(chainConf) {
      if(chainConf.type === 'Ethermint') {
        const ethProvider = new ethers.providers.JsonRpcProvider(chainConf.endpoint.evm_endpoint);
        const wallet = Wallet.fromMnemonic(chainConf.sender.mnemonic, pathToString(chainConf.sender.option.hdPaths[0])).connect(ethProvider);
        const wallet2 = Wallet.fromMnemonic(chainConf.sender.mnemonic, pathToString(chainConf.sender.option.hdPaths[0]));
        await wallet.getBalance().then(ethBlance => {
          balance = {
            denom:chainConf.tx.amount.denom,
            amount:ethBlance.toString()
          }
        }).catch(e => console.error(e))
        address = wallet2.address

      }else{
        const rpcEndpoint = chainConf.endpoint.rpc_endpoint;
        const wallet = await DirectSecp256k1HdWallet.fromMnemonic(chainConf.sender.mnemonic, chainConf.sender.option);
        const client = await SigningStargateClient.connectWithSigner(rpcEndpoint, wallet);
        const [firstAccount] = await wallet.getAccounts();
        await client.getBalance(firstAccount.address, chainConf.tx.amount[0].denom).then(x => {
          balance = x
        }).catch(e => console.error(e));
        address = firstAccount.address
      }
    }
  } catch(err) {
    console.log(err)
  }
  res.send({ status:'ok', result: { address, balance: [balance]}, message: 'success' });
})

// send tokens
app.get('/:chain/send/:address', async (req, res) => {
  const {chain, address} = req.params;
  const ip = req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.headers['X-Forwarded-For'] || req.ip
  console.log('request tokens to ', address, ip)
  if (chain || address ) {
    try {
      const chainConf = conf.blockchains.find(x => x.name === chain)
      const addressNE = await checker.checkAddress(address, chain)
      const ipNE = await checker.checkIp(`${chain}${ip}`, chain)

      if (chainConf && (address.startsWith(chainConf.sender.option.prefix) || address.startsWith('0x'))) {
        if ( await checker.checkVPN(ip) ) {
          console.log('blocked ip, suspected vpn', ip)
          if ( !addressNE ) {
            checker.update(address)
            checker.update(`${chain}${ip}`)
            res.send({ status:'error', result: 'Trying to cheat the system with VPN?', message: 'Trying to cheat the system with VPN?'})
            console.log("Cheat attempt with VPN", address)
            return
          } else {
            res.send({ status:'error', result: 'IP is blocked, please disconnect your VPN', message: 'IP is blocked, please disconnect your VPN'})
            return
          }
        }else if( await checker.checkTargetBalance(address, chain) ) {
          console.log('already have balance')
          checker.update(`${chain}${ip}`)
          res.send({ status:'error', result: 'You already have sufficient balance', message: 'You already have sufficient balance' })
          return
        }else if( !await checker.checkSourceBalance(chain) ) {
          console.log('insufficient balance')
          res.send({ status:'error', result: 'Insufficient balance, please consider donating to address below', message: 'Insufficient balance, please consider donating to address below' })
          return
        }else if( addressNE && ipNE ) {
          checker.update(`${chain}${ip}`)
          console.log('send tokens to ', address)
          sendTx(address, chain).then(ret => {
            checker.update(address)
            res.send({ status:'ok', result: ret })
          }).catch(err => {
            res.send({ result: `err: ${err}`})
          });
        }else if ( (!addressNE && ipNE) || (addressNE && !ipNE) ) {
          console.log('Cheat attempt detected!', address, ip)
          if ( !addressNE && ipNE ) {
            checker.update(`${chain}${ip}`)
          }
          if ( addressNE && !ipNE ) {
            checker.update(address)
          }
          res.send({ status:'error', result: "Trying to cheat the system? Wait another 24H from now", message: "Trying to cheat the system? Wait another 24H from now" })
        } else {
          res.send({ status:'error', result: "You requested too often", message: "You requested too often" })
        }
      } else {
        res.send({ status:'error',  result: `Address [${address}] is not supported.`, message: `Address [${address}] is not supported.` })
      }
    } catch (err) {
      console.error(err);
      res.send({ status:'error',  result: 'Failed, Please contact to admin.', message: 'Failed, Please contact to admin.' })
    }

  } else {
    // send result
    res.send({ result: 'address is required' });
  }
})

app.listen(conf.port, () => {
  console.log(`Faucet app listening on port ${conf.port}`)
})

async function sendCosmosTx(recipient, chain) {
  const chainConf = conf.blockchains.find(x => x.name === chain) 
  if(chainConf) {
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(chainConf.sender.mnemonic, chainConf.sender.option);
    const [firstAccount] = await wallet.getAccounts();

    const rpcEndpoint = chainConf.endpoint.rpc_endpoint;
    const client = await SigningStargateClient.connectWithSigner(rpcEndpoint, wallet);

    const amount = chainConf.tx.amount;
    const fee = chainConf.tx.fee;
    console.log("recipient", recipient, amount, fee);
    return client.sendTokens(firstAccount.address, recipient, amount, fee);
  }
  throw new Error(`Blockchain Config [${chain}] not found`)
}

async function sendEvmosTx(recipient, chain) {

  try{
    const chainConf = conf.blockchains.find(x => x.name === chain) 
    const ethProvider = new ethers.providers.JsonRpcProvider(chainConf.endpoint.evm_endpoint);

    const wallet = Wallet.fromMnemonic(chainConf.sender.mnemonic).connect(ethProvider);

    let evmAddress =  recipient;
    if(recipient && !recipient.startsWith('0x')) {
      let decode = bech32.decode(recipient);
      let array = bech32.fromWords(decode.words);
      evmAddress =  "0x" + toHexString(array);
    }

    let result = await wallet.sendTransaction(
        { 
          from:wallet.address,
          to:evmAddress,
          value:chainConf.tx.amount.amount
        }
      );

    let repTx = {
      "code":0,
      "nonce":result["nonce"],
      "value":result["value"].toString(),
      "hash":result["hash"]
    };

    console.log("xxl result : ",repTx);
    return repTx;
  }catch(e){
    console.log("xxl e ",e);
    return e;
  }

}

function toHexString(bytes) {
  return bytes.reduce(
      (str, byte) => str + byte.toString(16).padStart(2, '0'), 
      '');
}

async function sendTx(recipient, chain) {
  const chainConf = conf.blockchains.find(x => x.name === chain) 
  if(chainConf.type === 'Ethermint') {
    return sendEvmosTx(recipient, chain)
  }
  return sendCosmosTx(recipient, chain)
}

// write a function to send evmos transaction
async function sendEvmosTx2(recipient, chain) {

  // use evmosjs to send transaction
  const chainConf = conf.blockchains.find(x => x.name === chain) 
  // create a wallet instance
  const wallet = Wallet.fromMnemonic(chainConf.sender.mnemonic).connect(chainConf.endpoint.evm_endpoint);
}