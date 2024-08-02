import { Level } from "level";
import ipRangeCheck from "ip-range-check"
import axios from 'axios'

const WINDOW = 86400 * 1000 // milliseconds in a day
// const WINDOW = 20 * 1000 // 20s for test

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
        isBlocked = ipRangeCheck(ip, blocklist)
        return isBlocked
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
