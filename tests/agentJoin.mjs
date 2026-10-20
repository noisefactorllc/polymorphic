// Stands in for `node seance-agent.mjs join <link>` in the connect-agent test,
// so the prompt's join line runs through a real shell as written: it joins the
// session, sends its first request, prints the session code and app, and exits.
// SEANCE_AGENT_SERVER and SEANCE_AGENT_ORIGIN name the local Seance server.
import { joinAsAgent } from './agentRelayClient.js'

const [command, link] = process.argv.slice(2)
if (command !== 'join' || !link) {
    process.stderr.write('usage: agentJoin.mjs join <link>\n')
    process.exit(2)
}
const code = new URL(link).searchParams.get('seance')
const agent = await joinAsAgent({ server: process.env.SEANCE_AGENT_SERVER, code, origin: process.env.SEANCE_AGENT_ORIGIN })
try {
    const described = await agent.describe()
    process.stdout.write(`${JSON.stringify({ code, app: described.app, tab: described.from })}\n`)
} finally {
    agent.close()
}
