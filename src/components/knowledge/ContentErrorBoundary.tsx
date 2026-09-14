import { Component, type ReactNode } from 'react';
import { StateMessage } from './ApplicationUI';
export class ContentErrorBoundary extends Component<{children:ReactNode},{failed:boolean}> {
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<StateMessage error title="Content could not be loaded" action={<button className="btn-secondary" onClick={()=>this.setState({failed:false})}>Try again</button>}>Reload the page and try again. Your saved content has not been removed.</StateMessage>:this.props.children;}
}
