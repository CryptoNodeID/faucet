
import { stringToPath } from '@cosmjs/crypto'
import fs from 'fs'
// import { ethers } from 'ethers'
import { Wallet, utils } from 'ethers';

const HOME = ".faucet";
const mnemonic_path= `${HOME}/mnemonic.txt`
if (!fs.existsSync(mnemonic_path)) {
    fs.mkdirSync(HOME, { recursive: true })
    fs.writeFileSync(mnemonic_path, Wallet.fromMnemonic(
        utils.entropyToMnemonic(utils.randomBytes(32))
      ).mnemonic.phrase)
}

const mnemonic = fs.readFileSync(mnemonic_path, 'utf8')
console.log("======================== faucet mnemonic =========================")
console.log(mnemonic)
console.log("==================================================================")

export default {
    port: 58888, // http port
    db: {
        path: `${HOME}/history.db` // save request states
    },
    project: {
        name: "CryptoNodeID Faucet",
        logo: "https://github.com/CryptoNodeID/explorer/raw/master/public/logo.svg",
        deployer: `<a href="https://cryptonode.id">CryptoNodeID</a>`
    },
    blockchains: [
        {
            name: "empe",
            endpoint: {
                // make sure that CORS is enabled in rpc section in config.toml
                // cors_allowed_origins = ["*"]
                rpc_endpoint: "https://empe-testnet-rpc.cryptonode.id",
            },
            sender: {
                mnemonic,
                option: {
                    hdPaths: [stringToPath("m/44'/118'/0'/0/0")],
                    prefix: "empe" // human readable address prefix
                }
            },
            tx: {
                amount: [
                    {
                        denom: "uempe",
                        amount: "5000000"
                    },
                ],
                fee: {
                    amount: [
                        {
                            amount: "20",
                            denom: "uempe"
                        }
                    ],
                    gas: "200000"
                },
            },
            limit: {
                // how many times each wallet address is allowed in a window(24h)
                address: 1,
                // how many times each ip is allowed in a window(24h),
                // if you use proxy, double check if the req.ip is return client's ip.
                ip: 1
            }
        },
    ]
}
