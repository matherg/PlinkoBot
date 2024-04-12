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
    GatewayIntentBits.GuildMembers,
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
   // console.log(interaction)
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
      polls[nextPollId] = { options: {},  voters: {}, userDetails: {}, pollOptions: pollOptions };

      nextPollId++;

      await interaction.reply({
        content: 'Vote Now!',
        components: components
      });
      const replyMessage = await interaction.fetchReply();

      pollMessages[nextPollId -1] = {
        channelId: interaction.channelId,
        guildId: interaction.guildId,
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
    console.log(pollMessage.guildId)
    const guild = await client.guilds.fetch(pollMessage.guildId);
    const member = await guild.members.fetch(userId);
    const messageContent = `POLL ENDED: || ${member}  won with option: ${option}\nOut of ${optionNum} votes||`;
    await sendDiscordMessage(pollMessage.channelId, messageContent, replay.path);
    delete polls[pollId];

    res.setHeader('Access-Control-Allow-Origin', 'https://master--plinkopoll.netlify.app');
    res.json({ message: 'Poll ended successfully, winner announced.' });
  } else {
    res.status(404).send('Poll not found or it has already ended.');
  }
});



app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});
