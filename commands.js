import 'dotenv/config';
import { getRPSChoices } from './game.js';
import { capitalize, InstallGlobalCommands } from './utils.js';

// Get the game choices from game.js
function createCommandChoices() {
  const choices = getRPSChoices();
  const commandChoices = [];

  for (let choice of choices) {
    commandChoices.push({
      name: capitalize(choice),
      value: choice.toLowerCase(),
    });
  }

  return commandChoices;
}

// Simple test command

const END_POLL = {
  name: 'endpoll',
  description: 'Ends the most recent poll created',
  type: 1,
}
const PLINKO_POLL = {
  name: 'plinko_poll',
  description: 'Create a poll with custom options',
  options: [
    {
      type: 3, // STRING type
      name: 'options',
      description: 'Enter poll options separated by commas (e.g., "Option 1,Option 2,Option 3")',
      required: true,
    }
  ],
  type: 1,
};


const ALL_COMMANDS = [PLINKO_POLL, END_POLL];

InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);