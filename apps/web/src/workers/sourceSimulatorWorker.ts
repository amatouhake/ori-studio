import { expose } from 'comlink';
import { createSourceSimulatorSession } from '../simulator/sourceSimulatorSession';

expose(createSourceSimulatorSession());
