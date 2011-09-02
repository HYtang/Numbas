/*
Copyright 2011 Newcastle University

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/


Numbas.queueScript('scripts/exam.js',['json','timing','util','display','schedule','scorm-storage','pretendlms','math','question','jme-variables','jme-display'],function() {


// exam object keeps track of all info we need to know while exam is running
var Exam = Numbas.Exam = function()
{
	var parseBool = Numbas.util.parseBool;

	var json = this.json = Numbas.raw.examJSON;

	var exam = this;

	var tryLoad = function(path,to){
		to = to || exam;
		return Numbas.json.tryLoad(path,to,json);
	};

	['name','duration','percentPass','allQuestions','selectQuestions','shuffleQuestions'].map(tryLoad());

	this.navigation = Numbas.util.copyobj(this.navigation);
	['reverse','browse','showFrontPage'].map(tryLoad('settings.navigation',this.navigation));

	//get navigation events and actions
	var navEvents = this.navigation.events = {};

	['advance','reverse','move'].map(tryLoad('settings.navigation.events',navEvents));
	for( var ev in navEvents )
	{
		navEvents[ev] = new ExamEvent(navEvents[ev]);
	}

						
	//get timing events
	var timerEvents = this.timerEvents = {};
	['timeout','timedwarning'].map(tryLoad('settings.timing',timerEvents));
	for( var ev in timerEvents )
	{
		timerEvents[ev] = new ExamEvent(timerEvents[ev]);
	}
		
	//feedback
	['showActualMark','showTotalMark','showAnswerState','allowRevealAnswer','adviceType','adviceThreshold'].map(tryLoad('settings.feedback'));

	//rulesets
	this.rulesets = Numbas.util.copyobj(Numbas.jme.display.simplificationRules);
	for(var name in json.settings.rulesets)
	{
		var set = json.settings.rulesets[name].map(function(r) {
			if(typeof(r)=='string')
				return r;
			else
				return new Numbas.jme.display.Rule(r.pattern,r.conditions,r.result);
		});
		
		this.rulesets[name] = Numbas.jme.display.collectRuleset(set,this.rulesets);
	}

	this.rulesets['default'] = Numbas.jme.display.collectRuleset(['unitFactor','unitPower','unitDenominator','zeroFactor','zeroTerm','zeroPower','collectNumbers','zeroBase','constantsFirst','sqrtProduct','sqrtDivision','sqrtSquare','otherNumbers'],this.rulesets);

	//get text representation of exam duration
	this.displayDuration = this.duration>0 ? Numbas.timing.secsToDisplayTime( this.duration, true ) : '';

	this.totalQuestions = json.questions.length;

	//initialise display
	this.display = new Numbas.display.ExamDisplay(this);

}
Exam.prototype = {

	json: undefined,			//JSON object defining exam

	mode: 'entry',				//can be 	"entry" - exam not started yet
								//			"in progress" - exam started, not finished
                                //			"review" - looking at completed exam
                                //			"suspend" - exam is paused

	//exam properties
	name: '',					//title of exam
	mark: 0,					//total marks available in exam
	score: 0,					//student's current score
	percentPass: 0,				//percentage student must achieve to pass
	percentScore: 0,			//student's score as a percentage
	passed: false,				//did student pass the exam?

	//variables and functions
	functions: {},				//functions available to every question
	variables: {},				//variables available to every question
	
	//question selection
	totalQuestions: 0,			//how many questions are available?
	allQuestions: true,			//use all questions?
	selectQuestions: 0,			//how many questions to select, if not using all?
	shuffleQuestions: false,	//should the questions be shuffled?
	currentQuestion: undefined,	//current question object
	
	numQuestions: 0,			//number of questions in this sitting
	questionSubset: [],			//which questions from the pool to use? for reconstructing question list on resume
	questionList: [],			//Question objects, in order student will see them
		
	//navigation
	navigation: {
		showFrontPage: true,	//show the front page, or go straight to first question?
		reverse: false,			//can student navigate to previous question?
		browse: false,			//can student jump to any question they like?
		events: {}
	},

	timerEvents: {},			//events based on timing
	
	//timing
	duration: 0,				//how long is exam?
	displayDuration: '',//exam duration in h:m:s format
	timeoutAction: 'none',		//what to do when timer runs out
	timedWarningAction: 'none',	//warning 5 minutes before end?
	stopwatch: undefined,		//stopwatch object - updates timer every second
	endTime: undefined,			//time that the exam should stop
	timeRemaining: 0,			//seconds until end of exam
	timeSpent: 0,				//seconds exam has been in progress
	inProgress: false,			//is the exam in progress? False before starting, when paused, and after ending.

	start: Date(),				//time exam started
	stop: Date(),				//time exam finished
	
	//feedback
	showActualMark: false,		//show current score?
	showTotalMark: false,		//show total marks in exam?
	showAnswerState: false,		//tell student if answer is correct/wrong/partial ?
	allowRevealAnswer: false,	//allow 'reveal answer' button ?
	adviceType: '',				//something to do with when advice can be shown ??
	adviceThreshold: 0, 	//if student scores lower than this percentage on a question, the advice is displayed

	display: undefined,			//display code

	//stuff to do when starting exam afresh
	init: function()
	{
		var job = Numbas.schedule.add;
		var exam = this;
		job(function() {
			exam.functions = Numbas.jme.variables.makeFunctions(exam.json.functions);
			exam.variables = Numbas.jme.variables.makeVariables(exam.json.variables,exam.functions);
		});
		job(exam.chooseQuestionSubset,exam);			//choose questions to use
		job(exam.makeQuestionList,exam);				//create question objects
		job(Numbas.store.init,Numbas.store,exam);		//initialise storage
	},

	//restore previously started exam from storage
	load: function()
	{
		var suspendData = Numbas.store.load();	//get saved info from storage

		this.timeRemaining = suspendData.timeRemaining;
		this.questionSubset = suspendData.questionSubset;
		this.start = new Date(suspendData.start);
		this.score = suspendData.score;

		this.makeQuestionList(true);

		if(suspendData.location!==undefined)
			this.changeQuestion(suspendData.location);

		for(i=0; i<this.numQuestions; i++)
		{
			if(this.questionList[i].visited)
				this.questionList[i].display.showScore();
		}
		this.display.showScore();
	},


	//xmlize for info pages and so on
	xmlize: function()
	{
		var obj = {};
		var dontwant = ['xml','questionList','stopwatch','display','currentQuestion','navigationEvents','rulesets','functions','variables'];
		for( var x in this )
		{
			if(!(dontwant.contains(x) || typeof(this[x])=='function'))
				obj[x]=this[x];
		}

		return Sarissa.xmlize(obj,'exam');
	},

	//decide which questions to use and in what order
	chooseQuestionSubset: function()
	{
		//get all questions out of XML
		var tmpQuestionList = new Array();

		//decide how many questions in this sitting
		if( this.allQuestions )
		{
			this.numQuestions = this.totalQuestions;
		}
		else
		{
			this.numQuestions = Math.min(this.totalQuestions,this.selectQuestions);
		}

		//shuffle questions?
		this.questionSubset = [];
		if(this.shuffleQuestions)
		{
			this.questionSubset=Numbas.math.deal(this.numQuestions);
		}
		else	//otherwise just pick required number of questions from beginning of list
		{
			this.questionSubset = Numbas.math.range(this.numQuestions);
		}

		if(this.questionSubset.length==0)
		{
			Numbas.display.showAlert("This exam contains no questions! Check the .exam file for errors.");
		}
	},

	//having chosen which questions to use, make question list and create question objects
	//if loading, need to restore randomised variables instead of generating anew
	makeQuestionList: function(loading)
	{
		var job = Numbas.schedule.add;

		this.questionList = [];
		
		var questions = this.json.questions;
		for(var i = 0; i<this.questionSubset.length; i++) 
		{
			job(function(i)
			{
				var question = new Numbas.Question( questions[this.questionSubset[i]], i, loading, this.variables, this.functions );
				this.questionList.push(question);
			},this,i);
		}

		job(function() {
			//calculate max marks available in exam
			this.mark = 0;

			//go through the questions and recalculate the part scores, then the question scores, then the exam score
			for( i=0; i<this.numQuestions; i++ )
			{
				this.mark += this.questionList[i].marks;
			}
		},this);
	},
	
	//begin exam
	begin: function()
	{
		this.start = new Date();        //make a note of when the exam was started
		this.endTime = new Date(this.start.getTime()+this.duration*1000);	//work out when the exam should end

		this.changeQuestion(0);			//start at the first question!

		this.updateScore();				//initialise score

		//set countdown going
		if(this.mode!='review')
			this.startTiming();

		this.display.showQuestion();	//display the current question

	},

	pause: function()
	{
		this.endTiming();
		this.display.showInfoPage('suspend');

		Numbas.store.pause();
	},

	resume: function()
	{
		this.startTiming();
		this.display.showQuestion();
	},

	//set the stopwatch going
	startTiming: function()
	{
		this.inProgress = true;
		this.stopwatch = {
			start: new Date(),
			end: new Date((new Date()).getTime() + this.timeRemaining*1000),
			oldTimeSpent: this.timeSpent,
			id: setInterval(function(){exam.countDown();}, 1000)
		};

		if( this.duration > 0 )
			this.display.showTiming();
			
		else
			this.display.hideTiming();

		var exam = this;
		this.countDown();
	},

	//display time remaining and end exam when timer reaches zero
	countDown: function()
	{
		var t = new Date();
		this.timeSpent = this.stopwatch.oldTimeSpent + (t - this.stopwatch.start)/1000;

		if(this.duration > 0)
		{
			this.timeRemaining = Math.ceil((this.endTime - t)/1000);
			this.display.showTiming();

			if(this.duration > 300 && this.timeRemaining<300 && !this.showedTimeWarning)
			{
				this.showedTimeWarning = true;
				var e = this.timerEvents['timedwarning'];
				if(e && e.action=='warn')
				{
					Numbas.display.showAlert(e.message);
				}
			}
			else if(this.timeRemaining===0)
			{
				var e = this.timerEvents['timeout'];
				if(e && e.action=='warn')
				{
					Numbas.display.showAlert(e.message);
				}
				this.end();
			}	
		}
	},

	//stop the stopwatch
	endTiming: function()
	{
		this.inProgress = false;
		clearInterval( this.stopwatch.id );
	},


	//recalculate and display student's total score
	updateScore: function()
	{
		this.calculateScore();
		this.display.showScore();	
	},

	calculateScore: function()
	{
		this.score=0;
		for(var i=0; i<this.questionList.length; i++)
			this.score += this.questionList[i].score;
	},

	//call this when student wants to move between questions
	//will check move is allowed and if so change question and update display
	tryChangeQuestion: function(i)
	{
		if(i<0 || i>=this.numQuestions)
			return;

		var currentQuestion = this.currentQuestion;
		if(!currentQuestion)
			return;

		if(i==currentQuestion.number)
			return;

		var exam = this;
		function go()
		{
			exam.changeQuestion(i);
			exam.display.showQuestion();
		}

		if(currentQuestion.answered)
		{
			go();
		}
		else
		{
			//work out what action is happening
			var event = '';
			if(i==currentQuestion.number-1)		//reversing
				event='reverse';
			else if(i==currentQuestion.number+1)	//advancing
				event='advance';
			else								//jumping
				event='move';

			var eventObj = this.navigation.events[event];
			switch( eventObj.action )
			{
			case 'none':
				go();
				break;
			case 'warnifunattempted':
				Numbas.display.showConfirm(eventObj.message+'<p>Proceed anyway?</p>',go);
				break;
			case 'preventifunattempted':
				Numbas.display.showAlert(eventObj.message);
				break;
			}
		}
	},

	//actually change the current question
	changeQuestion: function(i)
	{
		this.currentQuestion = this.questionList[i];
		if(!this.currentQuestion)
		{
			throw(new Error("This exam contains no questions! Check the .exam file for errors."));
		}
		this.currentQuestion.visited = true;
		Numbas.store.changeQuestion(this.currentQuestion);
	},

	end: function()
	{
		//get time of finish
		this.stop = new Date();
		
		//stop the stopwatch
		this.endTiming();

		//work out summary info
		this.percentScore = Math.round(100*this.score/this.mark);
		this.passed = this.percentScore >= this.percentPass;

		//construct report object
		var report = this.report = 
		{	examsummary: {	name: this.name,
							numberofquestions: this.numQuestions, 
							mark: this.mark,
							passpercentage: this.percentPass,
							duration: this.displayDuration 
						 },
			performancesummary: {	start: this.start.toGMTString(),
									stop: this.stop.toGMTString(),
									timespent: Numbas.timing.secsToDisplayTime(this.timeSpent),
									score: this.score,
									percentagescore: this.percentScore,
									passed: this.passed,
									result: (this.passed ? 'Passed' :'Failed')
								},
			questions: new Array()
		};

		//construct reports for each question
		var examQuestionsAttempted = 0;
		for(var j=0; j<this.questionList.length; j++)
		{
			var question = this.questionList[j];
			if(question.answered)
				examQuestionsAttempted++;

			report.questions.push({question: {	number: question.number+1,
												name: question.name,
												marks: question.marks,
												score: question.score } });
		}
		report.performancesummary.questionsattempted = examQuestionsAttempted;


		//send result to LMS, and tell it we're finished
		Numbas.store.end();

		//display the results
		this.display.showInfoPage( 'result' );
	},

	exit: function()
	{
		this.display.showInfoPage('exit');
	}
};

function ExamEvent(json)
{
	['type','action','message'].map(Numbas.json.tryLoad('',this,json));
	this.message = textile(this.message);
}
ExamEvent.prototype = {
	type: '',
	action: 'none',
	message: ''
};

});
