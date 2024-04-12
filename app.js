import 'dotenv/config';
import express from 'express';
import {
  InteractionType,
  InteractionResponseType,
  InteractionResponseFlags,
  MessageComponentTypes,
  ButtonStyleTypes,
} from 'discord-interactions';

import { Client,Events, AttachmentBuilder,GatewayIntentBits, EmbedBuilder, ButtonBuilder, ActionRowBuilder } from 'discord.js';

import { VerifyDiscordRequest, getRandomEmoji, DiscordRequest } from './utils.js';
import cors from 'cors';
import multer  from 'multer';
import * as fs from "node:fs";
import FormData from "form-data";
const corsOptions = {
  origin: 'https://master--plinkopoll.netlify.app',
  methods: 'POST',
  allowedHeaders: 'Content-Type',
  optionsSuccessStatus: 200
};

// Create an express app
const app = express();
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});
client.once(Events.ClientReady, readyClient => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

// Log in to Discord with your client's token
client.login(process.env.DISCORD_TOKEN);

// Get port, or default to 3000
const PORT = process.env.PORT || 3000;
// Parse request body and verifies incoming requests using discord-interactions package
app.use(express.json({ verify: VerifyDiscordRequest(process.env.PUBLIC_KEY) }));
app.use(cors(corsOptions));
const upload = multer(
    { dest: 'uploads/', limits: { fileSize: 100000000 }
});

// Store for in-progress games. In production, you'd want to use a DB
const pollMessages = {};
const polls = {};
let nextPollId = 0;
/*
async function sendDiscordMessage(channelId, content, videoPath) {
  const url = `https://discord.com/api/v10/channels/${channelId}/messages`;
  const formData = new FormData();
  formData.append('payload_json', JSON.stringify({ content }));

  // Append the video file
  formData.append('files[0]', fs.createReadStream(videoPath));


  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
      //...formData.getHeaders()
    },
    body: formData
  });
console.log(formData);
  if (!response.ok) {
    console.log(response);
    throw new Error(`Failed to send message: ${response.statusText}`);
  }
  console.log(response)

  fs.unlink(videoPath, (err) => {
    if (err) {
      console.error(`Error deleting file ${videoPath}: ${err}`);
    } else {
      console.log(`File ${videoPath} was deleted successfully`);
    }
  });
}
async function deleteDiscordMessage(channelId, messageId) {
  const url = `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bot ${process.env.DISCORD_TOKEN}`
    }
  });

  if (!response.ok) {
    // Handle any errors if the request was not successful
    throw new Error(`Failed to delete message: ${response.statusText}`);
  }
}*/
async function sendDiscordMessage(channelId, content, videoPath) {
  try {
    const channel = await client.channels.fetch(channelId);
    const file = new AttachmentBuilder(videoPath, { name: 'replay.mp4' });
    await channel.send({ content, files: [file] });
  } catch (error) {
    console.error('Error sending message:', error);
  }
}

async function deleteDiscordMessage(channelId, messageId) {
  try {
    const channel = await client.channels.fetch(channelId);
    const message = await channel.messages.fetch(messageId);
    await message.delete();
  } catch (error) {
    console.error('Error deleting message:', error);
  }
}
// Helper function to update poll votes
function handleVote(customId, userId, username, avatar) {
  const pollId = customId.split('_')[2];
  const optionIndex = customId.split('_')[3];



  // Remove the user's vote from all options
  Object.keys(polls[pollId].options).forEach(option => {
    const voters = polls[pollId].options[option];
    if (voters) {
      const voterIndex = voters.indexOf(userId);
      if (voterIndex !== -1) {
        voters.splice(voterIndex, 1);
      }
    }
  });

  // Add the user's vote to the new option
  if (!polls[pollId].options[optionIndex]) {
    polls[pollId].options[optionIndex] = [];
  }
  if (!polls[pollId].options[optionIndex].includes(userId)) {
    polls[pollId].options[optionIndex].push(userId);
  }

  // Save the user details
  polls[pollId].userDetails[userId] = { username, avatar };

  // Keep track of voters to ensure a user can only vote once
  polls[pollId].voters[userId] = optionIndex;
}
function createPollButtons(options) {
  const optionButtons = options.map((option, index) => {
    return {
      type: MessageComponentTypes.BUTTON,
      style: ButtonStyleTypes.PRIMARY,
      label: `${option}`,
      custom_id: `poll_vote_${nextPollId}_${index}`,
    };
  });

  // Action row for option buttons
  const optionActionRow = {
    type: MessageComponentTypes.ACTION_ROW,
    components: optionButtons
  };

  // Action row for "Launch Poll" button
  const launchPollActionRow = {
    type: MessageComponentTypes.ACTION_ROW,
    components: [{
      type: MessageComponentTypes.BUTTON,
      style: ButtonStyleTypes.LINK,
      label: 'Launch Poll',
      url: `https://master--plinkopoll.netlify.app/${nextPollId}`, // The URL the button directs to
    }]
  };

  return [optionActionRow, launchPollActionRow];
}
/**
 * Interactions endpoint URL where Discord will send HTTP requests
 */

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand() && !interaction.isMessageComponent()) return;

   if (interaction.isMessageComponent()) {
    const { customId, user, member } = interaction;
    console.log(interaction)
    if (customId.startsWith('poll_vote_')) {
      const userId = member.user.id; // The user's Discord ID
      const username = member.user.username; // The user's username
      const avatar = member.user.avatar; // The user's avatar hash
      const avatarURL = `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png`; // Construct the URL for the avatar

      handleVote(customId, userId, username, avatarURL);

      await interaction.deferUpdate();
    }
  } else if (interaction.isCommand()) {
    const {   options } = interaction;

    if (interaction.commandName === 'endpoll') {
      const pollId = interaction.options.getInteger('poll_id');
      const poll = polls[pollId];
      if (poll) {
        await deleteDiscordMessage(poll.channelId, poll.messageId);
        delete polls[pollId];
        await interaction.reply('Poll ended.');
      } else {
        await interaction.reply('Poll not found.');
      }
    } else if  (interaction.commandName === 'plinko_poll') {
      const optionsString = options.getString('options');
      const pollOptions = optionsString.split(',').map(option => option.trim());

      const components = createPollButtons(pollOptions);
      polls[nextPollId] = { options: {}, voters: {}, userDetails: {}, pollOptions: pollOptions };

      nextPollId++;

      await interaction.reply({
        content: 'Vote Now!',
        components: components
      });
      const replyMessage = await interaction.fetchReply();

      pollMessages[nextPollId -1] = {
        channelId: interaction.channelId,
        messageId: replyMessage.id
      };
    }
  }
});
// Endpoint to get poll data
app.get('/getPoll/:id', function (req, res) {
  const pollId = req.params.id;
  if (polls[pollId]) {
    res.json({
      pollId: pollId,
      options: polls[pollId].pollOptions,
      votes: polls[pollId].voters,
      voters: Object.entries(polls[pollId].userDetails).map(([userId, details]) => ({
        userId,
        username: details.username,
        avatarURL: details.avatar
      }))
    });
  } else {
    res.status(404).send('Poll not found');
  }
});
app.post('/endpoll', upload.single('replay'), async function (req, res) {
  const { userId, pollId, option, optionNum } = req.body;
  const replay = req.file;
  if (polls[pollId]) {
    const pollMessage = pollMessages[pollId];
    if (pollMessage) {
      try {
        await deleteDiscordMessage(pollMessage.channelId, pollMessage.messageId);
        delete pollMessages[pollId];
      } catch (error) {
        console.error('Error deleting Discord message:', error);
        return res.status(500).send('Failed to delete Discord message.');
      }
    }
    // Clear the poll data
    // Send a message with who won the poll and what option they chose
    const messageContent = `POLL ENDED: ||<@${userId}> won with option: ${option}\nOut of ${optionNum} votes||`;
    delete polls[pollId];
    await sendDiscordMessage(pollMessage.channelId, messageContent, replay.path);

    res.setHeader('Access-Control-Allow-Origin', 'https://master--plinkopoll.netlify.app');
    res.json({ message: 'Poll ended successfully, winner announced.' });
  } else {
    res.status(404).send('Poll not found or it has already ended.');
  }
});

   /*
  app.post('/interactions',express.json({ verify: VerifyDiscordRequest(process.env.PUBLIC_KEY) }), async function (req, res) {
    // Interaction type and data
    const {type, data, member, channel_id} = req.body;

    if (type === InteractionType.PING) {
      return res.send({type: InteractionResponseType.PONG});
    }


    if (type === InteractionType.MESSAGE_COMPONENT) {
      const { custom_id } = data;

      if (custom_id.startsWith('poll_vote_')) {
        const userId = member.user.id; // The user's Discord ID
        const username = member.user.username; // The user's username
        const avatar = member.user.avatar; // The user's avatar hash
        const avatarURL = `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png`; // Construct the URL for the avatar

        handleVote(custom_id, userId, username, avatarURL);

        // Acknowledge the button click without sending a message
        return res.send({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
      }
    }

  if (type === InteractionType.APPLICATION_COMMAND) {
    const {name} = data;

    if (name === 'endpoll') {
      let pollId = data.options?.find(option => option.name === 'id')?.value || nextPollId-1;

      const pollData = polls[pollId];
      if (pollData) {
        const pollMessage = pollMessages[pollId];
        if (pollMessage) {
          deleteDiscordMessage(pollMessage.channelId, pollMessage.messageId);
          delete pollMessages[pollId];
        }

        delete polls[pollId];

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: 'The poll has ended.',
          },
        });
      } else {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: 'Poll not found or it has already ended.',
          },
        });
      }
    }
    if (name === 'plinko_poll') {
      // Create buttons for the poll
      const optionsString = data.options.find(option => option.name === 'options').value;
      const pollOptions = optionsString.split(',').map(option => option.trim()); // Split and trim options

      // Dynamic creation of buttons based on user input
      const components = createPollButtons(pollOptions);
      nextPollId += 1;
      polls[nextPollId - 1] = { options: {}, voters: {}, userDetails: {}, pollOptions: pollOptions };

      const response = await fetch(`https://discord.com/api/v10/channels/${channel_id}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${process.env.DISCORD_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          content: 'Vote Now!', // Prompt message for voting
          components: components
        })
      });

      // If response is ok, parse the response
      if (response.ok) {
        const pollMessage = await response.json(); // This automatically decompresses and parses JSON
        // Store the channel ID and message ID of the poll
        pollMessages[nextPollId -1] = {
          channelId: channel_id,
          messageId: pollMessage.id
        };

      } else {
        console.error('Failed to send poll message:', await response.text());
      }

      // Acknowledge the slash command with a deferred message
      console.log("sending reply")
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE
      });
    }
  }
});
*/

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});
