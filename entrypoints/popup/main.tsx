import { render } from 'solid-js/web';

import './style.css';
import App from './App';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from popup/index.html');

render(() => <App />, root);
