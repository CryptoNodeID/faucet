import { Level } from "level";
import ipRangeCheck from "ip-range-check"
import axios from 'axios'
import cfg from './config.js'
import { SigningStargateClient } from "@cosmjs/stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { Wallet } from '@ethersproject/wallet'
import { pathToString } from '@cosmjs/crypto';

const WINDOW = 82800 * 1000 // milliseconds in a day
const cfSecret = cfg.cfSecret
const blocklist = []
axios.get('https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/datacenter/ipv4.txt')
  .then(res => blocklist.push(...res.data.split('\n')))
  .catch(err => console.error(err))
axios.get('https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/vpn/ipv4.txt')
  .then(res => blocklist.push(...res.data.split('\n')))
  .catch(err => console.error(err))

export class FrequencyChecker {
    constructor(conf) {
        this.conf = conf
        this.db = new Level(conf.db.path, { valueEncoding: 'json' });
    }

    async validateCaptcha(token,ip) {
        let formData = new FormData();
        formData.append('secret', cfSecret);
        formData.append('response', token);
        formData.append('remoteip', ip);

        const url = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
        const result = await fetch(url, {
            body: formData,
            method: 'POST',
        });

        const outcome = await result.json();
        if (outcome.success) {
            return true
        }
    }

    async check(key, limit) {
        return new Promise((resolve) => {
            this.db.get(key, function (err, value) {
                const now = Date.now()
                if (err || value && value.filter(x => now - x < WINDOW).length < limit) {
                    resolve(true)
                    // console.log(key, limit, value, true)
                } else {
                    resolve(false)
                    // console.log(key, limit, false)
                }
            });
        })
    }

    async checkVPN(ip) {
        const isBlocked = ipRangeCheck(ip, blocklist)
        return isBlocked
    }

    async checkTargetBalance(address, chain) {
        const chainConf = cfg.blockchains.find(x => x.name === chain)
        let balance = {}

        try{
            if(chainConf) {
                if(chainConf.type === 'Ethermint') {
                    const ethProvider = new ethers.providers.JsonRpcProvider(chainConf.endpoint.evm_endpoint);
                    ethProvider.getBalance(address)
                    .then(ethBalance => {
                        balance = ethBalance
                    })
                    .catch(e => {console.error('Error querying balance:', e)});
                }else{
                    const rpcEndpoint = chainConf.endpoint.rpc_endpoint;
                    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(chainConf.sender.mnemonic, chainConf.sender.option);
                    const client = await SigningStargateClient.connectWithSigner(rpcEndpoint, wallet);
                    await client.getBalance(address, chainConf.tx.amount[0].denom).then(x => {
                    balance = x
                    }).catch(e => console.error(e));
                }
            }
        } catch(err) {
            console.log(err)
        }
        if (parseInt(balance.amount) >= parseInt(chainConf.tx.amount[0].amount)) {
            return true
        } else {
            return false
        }
    }

    async checkSourceBalance(chain) {
        const chainConf = cfg.blockchains.find(x => x.name === chain)
        let balance = {}

        try{
            if(chainConf) {
                if(chainConf.type === 'Ethermint') {
                    const ethProvider = new ethers.providers.JsonRpcProvider(chainConf.endpoint.evm_endpoint);
                    const wallet = Wallet.fromMnemonic(chainConf.sender.mnemonic, pathToString(chainConf.sender.option.hdPaths[0])).connect(ethProvider);
                    await wallet.getBalance().then(ethBlance => {
                    balance = {
                        denom:chainConf.tx.amount.denom,
                        amount:ethBlance.toString()
                    }
                    }).catch(e => console.error(e))
                }else{
                    const rpcEndpoint = chainConf.endpoint.rpc_endpoint;
                    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(chainConf.sender.mnemonic, chainConf.sender.option);
                    const client = await SigningStargateClient.connectWithSigner(rpcEndpoint, wallet);
                    const [firstAccount] = await wallet.getAccounts();
                    await client.getBalance(firstAccount.address, chainConf.tx.amount[0].denom).then(x => {
                    balance = x
                    }).catch(e => console.error(e));
                }
            }
        } catch(err) {
            console.log(err)
        }
        if (parseInt(balance.amount) > parseInt(chainConf.tx.amount[0].amount) + parseInt(chainConf.tx.fee.amount[0].amount)) {
            return true
        }
    }

    async checkIp(ip, chain) {
        const chainLimit = this.conf.blockchains.find(x => x.name === chain)
        return chainLimit ? this.check(ip, chainLimit.limit.ip ) : Promise.resolve(false)
    }

    async checkAddress(address, chain) {
        const chainLimit = this.conf.blockchains.find(x => x.name === chain)
        return chainLimit ? this.check(address, chainLimit.limit.address ) : Promise.resolve(false)
    }

    async update(key) {
        const db = this.db
        db.get(key, function (err, history) {
            if (err) {
                db.put(key, [Date.now()])
            } else {
                history.push(Date.now())
                db.put(key, history)
            }
        });
    }
}
